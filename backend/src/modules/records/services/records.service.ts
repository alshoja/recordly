import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Scope,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';

import { extname } from 'node:path';
import { DocumentIngestionQueueService } from 'src/modules/ai/document-embedding/services/document-ingestion-queue.service';
import { AuthenticatedRequest } from 'src/modules/auth/types/express';
import { UserRole } from 'src/modules/users/enums/user-role.enum';
import { StepFiveDto } from '../dto/step-five.dto';
import { StepFourDto } from '../dto/step-four.dto';
import { StepOneDto } from '../dto/step-one.dto';
import { StepSixDto } from '../dto/step-six.dto';
import { StepThreeDto } from '../dto/step-three.dto';
import { StepTwoDto } from '../dto/step-two.dto';
import { Address } from '../entities/address.entity';
import { Child } from '../entities/child.entity';
import { Document } from '../entities/document.entity';
import { IdentityDocument } from '../entities/identity-document.entity';
import { FinancialAccount } from '../entities/financial-account.entity';
import { RecordStatus } from '../enums/record-status.enum';
import { Record as RecordEntity } from '../entities/record.entity';
import { StorageService } from 'src/shared/services/storage.service';
import { EncryptionUtility } from 'src/utilities/encryption.utility';
import {
  PROFILE_IMAGES_BUCKET,
  RECORD_DOCUMENTS_BUCKET,
  TRANSIENT_BUCKET,
} from 'src/shared/constants/storage.constants';
import { StoredObjectStream } from 'src/shared/interfaces/stored-object.interface';


@Injectable({ scope: Scope.REQUEST })
export class RecordsService {
  private readonly logger = new Logger(RecordsService.name);

  constructor(
    @Inject(REQUEST)
    private request: AuthenticatedRequest,
    @InjectRepository(RecordEntity)
    private readonly recordRepository: Repository<RecordEntity>,
    private dataSource: DataSource,
    private readonly documentIngestionQueueService: DocumentIngestionQueueService,
    private readonly storageService: StorageService,
  ) {}

  async createStepOne(
    stepOneDto: StepOneDto,
  ): Promise<{ id: number; status: RecordStatus; lastCompletedStep: number }> {
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    let createdProfileReference: string | undefined;
    let stagingProfileReference: string | undefined;
    let previousProfileReference: string | undefined;
    try {
      let recordId: number;
      const userId = this.request.user.sub;
      const recordRepository = queryRunner.manager.getRepository(RecordEntity);
      const action = this.determineStepSubmissionAction(stepOneDto.status, 1);
      const {
        status: _status,
        profileImage: submittedProfileImage,
        ...stepOnePayload
      } = stepOneDto;
      const createPayload = {
        ...stepOnePayload,
        profileImage: null,
        userId,
        createdBy: userId,
        updatedBy: userId,
      };

      const existingRecord = stepOneDto.id
        ? await recordRepository.findOne({
            where: { id: stepOneDto.id, userId },
          })
        : null;

      if (existingRecord) {
        this.ensureRecordEditable(existingRecord);
        previousProfileReference = existingRecord.profileImage;
        const promoted = await this.promoteProfileImage(
          submittedProfileImage,
          userId,
          existingRecord.id,
          existingRecord.profileImage,
        );
        createdProfileReference = promoted.createdReference;
        stagingProfileReference = promoted.stagingReference;
        await recordRepository.update(
          { id: stepOneDto.id, userId },
          {
            ...stepOnePayload,
            profileImage: promoted.reference,
            updatedBy: userId,
          },
        );
        recordId = existingRecord.id;
      } else if (stepOneDto.id) {
        throw new NotFoundException(
          `Record with ID ${stepOneDto.id} not found`,
        );
      } else {
        const newRecord = await recordRepository.insert(createPayload);
        recordId = newRecord.identifiers[0].id;
        const promoted = await this.promoteProfileImage(
          submittedProfileImage,
          userId,
          recordId,
        );
        createdProfileReference = promoted.createdReference;
        stagingProfileReference = promoted.stagingReference;
        await recordRepository.update(
          { id: recordId, userId },
          { profileImage: promoted.reference },
        );
      }

      await this.applyStepAction(recordRepository, recordId, 1, action, userId);
      const record = await recordRepository.findOneOrFail({ where: { id: recordId } });
      await queryRunner.commitTransaction();
      await this.storageService.delete(stagingProfileReference).catch(() => undefined);
      if (
        previousProfileReference &&
        previousProfileReference !== record.profileImage
      ) {
        await this.storageService.delete(previousProfileReference).catch(() => undefined);
      }
      return {
        id: recordId,
        status: record.status,
        lastCompletedStep: record.lastCompletedStep,
      };
    } catch (err) {
      this.logRollback(1, err);
      await queryRunner.rollbackTransaction();
      await this.storageService.delete(createdProfileReference).catch(() => undefined);
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async createStepTwo(
    { identityDocuments, status }: StepTwoDto,
    recordsId: number,
  ): Promise<{ id: number; status: RecordStatus; lastCompletedStep: number }> {
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const existingRecord = await this.findOne(recordsId);
      this.ensureRecordEditable(existingRecord);
      const userId = this.request.user.sub;
      const recordRepository = queryRunner.manager.getRepository(RecordEntity);
      const identityDocumentRepository =
        queryRunner.manager.getRepository(IdentityDocument);
      const action = this.determineStepSubmissionAction(status, 2);
      const normalizedIdentityDocuments = identityDocuments ?? [];
      const _identityDocuments = normalizedIdentityDocuments.map((document) => ({
        type: document.type?.trim() ? document.type : null,
        number: EncryptionUtility.encryptIfNeeded(document.number),
        recordsId,
      }));

      await identityDocumentRepository.delete({ recordsId });
      if (_identityDocuments.length > 0) {
        await identityDocumentRepository.insert(_identityDocuments);
      }

      await this.applyStepAction(recordRepository, recordsId, 2, action, userId);
      const record = await recordRepository.findOneOrFail({ where: { id: recordsId } });
      await queryRunner.commitTransaction();
      return {
        id: recordsId,
        status: record.status,
        lastCompletedStep: record.lastCompletedStep,
      };
    } catch (err) {
      this.logRollback(2, err);
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
  async createStepThree(
    { addresses, status, ...updateOccupationDto }: StepThreeDto,
    recordsId: number,
  ): Promise<{ id: number; status: RecordStatus; lastCompletedStep: number }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const existingRecord = await this.findOne(recordsId);
      this.ensureRecordEditable(existingRecord);
      const userId = this.request.user.sub;
      const normalizedAddresses = addresses ?? [];
      const _addresses = normalizedAddresses.map((address) => ({
        addressLine1: this.normalizeNullableString(address.addressLine1),
        addressLine2: this.normalizeNullableString(address.addressLine2),
        city: this.normalizeNullableString(address.city),
        state: this.normalizeNullableString(address.state),
        postalCode: this.normalizeNullableString(address.postalCode),
        country: this.normalizeNullableString(address.country),
        locationType: this.normalizeNullableString(address.locationType),
        recordsId,
      }));

      const recordRepository = queryRunner.manager.getRepository(RecordEntity);
      const addressRepository = queryRunner.manager.getRepository(Address);
      const stepAction = this.determineStepSubmissionAction(status, 3);

      const createdRecord = recordRepository.create({
        ...updateOccupationDto,
      });

      await addressRepository.delete({ recordsId });
      if (_addresses.length > 0) {
        await addressRepository.insert(_addresses);
      }
      await recordRepository.update(
        { id: recordsId },
        { ...createdRecord, updatedBy: userId },
      );
      await this.applyStepAction(
        recordRepository,
        recordsId,
        3,
        stepAction,
        userId,
      );
      const record = await recordRepository.findOneOrFail({ where: { id: recordsId } });

      await queryRunner.commitTransaction();
      return {
        id: recordsId,
        status: record.status,
        lastCompletedStep: record.lastCompletedStep,
      };
    } catch (err) {
      this.logRollback(3, err);
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async createStepFour(
    { children, status, ...updateFamilyDto }: StepFourDto,
    recordsId: number,
  ): Promise<{ id: number; status: RecordStatus; lastCompletedStep: number }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const existingRecord = await this.findOne(recordsId);
      this.ensureRecordEditable(existingRecord);
      const userId = this.request.user.sub;
      const normalizedChildren = children ?? [];
      const _children = normalizedChildren.map((child) => ({
        ...child,
        recordsId,
      }));
      const stepAction = this.determineStepSubmissionAction(status, 4);
      const recordRepository = queryRunner.manager.getRepository(RecordEntity);
      const childRepository = queryRunner.manager.getRepository(Child);

      await childRepository.delete({ recordsId });
      if (_children.length > 0) {
        await childRepository.insert(_children);
      }
      const hasStepFourValues = Object.values(updateFamilyDto).some(
        (value) => value !== undefined && value !== null && value !== '',
      );

      if (hasStepFourValues) {
        const createdRecord = recordRepository.create({
          ...updateFamilyDto,
        });
        await recordRepository.update(
          { id: recordsId },
          { ...createdRecord, updatedBy: userId },
        );
      }
      await this.applyStepAction(
        recordRepository,
        recordsId,
        4,
        stepAction,
        userId,
      );
      const record = await recordRepository.findOneOrFail({ where: { id: recordsId } });
      await queryRunner.commitTransaction();
      return {
        id: recordsId,
        status: record.status,
        lastCompletedStep: record.lastCompletedStep,
      };
    } catch (err) {
      this.logRollback(4, err);
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async createStepFive(
    stepFiveDto: StepFiveDto,
    recordsId: number,
  ): Promise<{ id: number; status: RecordStatus; lastCompletedStep: number }> {
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const existingRecord = await this.findOne(recordsId);
      this.ensureRecordEditable(existingRecord);
      const userId = this.request.user.sub;
      const action = this.determineStepSubmissionAction(stepFiveDto.status, 5);
      const financialAccounts = stepFiveDto.financialAccounts.map((financialAccount) => ({
        type: financialAccount.type?.trim() ? financialAccount.type : null,
        provider: financialAccount.provider?.trim() ? financialAccount.provider : null,
        number: EncryptionUtility.encryptIfNeeded(financialAccount.number),
        recordsId,
      }));

      const financialAccountRepository = queryRunner.manager.getRepository(FinancialAccount);
      const recordRepository = queryRunner.manager.getRepository(RecordEntity);
      await financialAccountRepository.delete({ recordsId });
      await financialAccountRepository.insert(financialAccounts);
      await this.applyStepAction(recordRepository, recordsId, 5, action, userId);
      const record = await recordRepository.findOneOrFail({ where: { id: recordsId } });

      await queryRunner.commitTransaction();
      return {
        id: recordsId,
        status: record.status,
        lastCompletedStep: record.lastCompletedStep,
      };
    } catch (err) {
      this.logRollback(5, err);
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async createStepSix(
    stepSixDto: StepSixDto,
    recordsId: number,
  ): Promise<{ id: number; status: RecordStatus; lastCompletedStep: number }> {
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    let removedDocumentReferences: string[] = [];
    try {
      const existingRecord = await this.findOne(recordsId);
      this.ensureRecordEditable(existingRecord);
      const userId = this.request.user.sub;
      const action = this.determineStepSubmissionAction(stepSixDto.status, 6);
      const existingDocuments = existingRecord.documents ?? [];
      const _document = await Promise.all(
        stepSixDto.documents.map(async (document) => {
          const { file, size, uploadedAt } = await this.resolveDocumentMetadata(
            document.file,
            existingRecord.userId,
            recordsId,
            existingDocuments,
          );
          return {
            name: document.name?.trim() ? document.name : null,
            file,
            mimeType: this.getDocumentMimeType(file),
            size,
            ...(uploadedAt ? { uploadedAt } : {}),
            recordsId,
          };
        }),
      );
      const retainedReferences = new Set(_document.map((document) => document.file));
      removedDocumentReferences = existingDocuments
        .map((document) => document.file)
        .filter((file) => file && !retainedReferences.has(file));
      const documentRepository = queryRunner.manager.getRepository(Document);
      const recordRepository = queryRunner.manager.getRepository(RecordEntity);
      await documentRepository.delete({ recordsId });
      const insertedDocuments = await documentRepository.insert(_document);
      if (action === 'FINAL') {
        await this.validateFinalSubmission(recordRepository, recordsId);
      }
      await this.applyStepAction(recordRepository, recordsId, 6, action, userId);
      const record = await recordRepository.findOneOrFail({ where: { id: recordsId } });

      await queryRunner.commitTransaction();
      await this.storageService.deleteMany(removedDocumentReferences);
      await this.documentIngestionQueueService
        .queueDocuments(
          insertedDocuments.identifiers.map((identifier) => identifier.id),
        )
        .catch((error) =>
          this.logger.error(
            `Failed to queue document embedding for record ${recordsId}`,
            error instanceof Error ? error.stack : undefined,
          ),
        );
      return {
        id: recordsId,
        status: record.status,
        lastCompletedStep: record.lastCompletedStep,
      };
    } catch (err) {
      this.logRollback(6, err);
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async findAll(
    search: string | undefined,
    page: number,
    limit: number,
    sortBy: string,
    sortOrder: 'ASC' | 'DESC',
    status?: RecordStatus | 'ALL',
  ): Promise<{ data: RecordEntity[]; total: number }> {
    try {
      const userId = this.request.user.sub;
      const isAdmin = this.request.user.role === UserRole.ADMIN;
      const normalizedSortOrder = sortOrder.toUpperCase() as 'ASC' | 'DESC';
      const recordSortColumnMap: Record<string, string> = {
        id: 'record.id',
        firstName: 'record.firstName',
        lastName: 'record.lastName',
        email: 'record.email',
        mobileNumber: 'record.mobileNumber',
        gender: 'record.gender',
        createdAt: 'record.createdAt',
        status: 'record.status',
      };
      const mappedRecordSortColumn =
        recordSortColumnMap[sortBy] ?? 'record.createdAt';
      const query = this.recordRepository
        .createQueryBuilder('record')
        .leftJoinAndSelect('record.addresses', 'addresses')
        .leftJoinAndSelect('record.children', 'children')
        .leftJoinAndSelect('record.financialAccounts', 'financialAccounts')
        .leftJoinAndSelect('record.documents', 'documents')
        .leftJoinAndSelect('record.identityDocuments', 'identityDocuments')
        .leftJoinAndSelect('record.user', 'user')
        .skip((page - 1) * limit)
        .take(limit);

      if (sortBy === 'addedBy') {
        query
          .orderBy('user.firstName', normalizedSortOrder)
          .addOrderBy('user.lastName', normalizedSortOrder)
          .addOrderBy('record.createdAt', 'DESC');
      } else {
        query.orderBy(mappedRecordSortColumn, normalizedSortOrder);
      }

      if (isAdmin) {
        query.andWhere(
          new Brackets((qb) => {
            qb.where('record.status != :draftStatus', {
              draftStatus: RecordStatus.DRAFT,
            }).orWhere('record.userId = :userId', { userId });
          }),
        );
      } else {
        query.andWhere('record.userId = :userId', { userId });
      }

      if (search) {
        query.andWhere(
          new Brackets((qb) => {
            qb.where('record.firstName ILIKE :search', { search: `%${search}%` })
              .orWhere('record.lastName ILIKE :search', { search: `%${search}%` })
              .orWhere('record.email ILIKE :search', { search: `%${search}%` })
              .orWhere('record.mobileNumber ILIKE :search', {
                search: `%${search}%`,
              });
          }),
        );
      }

      if (status && status !== 'ALL') {
        query.andWhere('record.status = :status', { status });
      }

      const [records, total] = await query.getManyAndCount();
      const data = records.map((record) => this.toPublicRecord(record));

      return { data, total };
    } catch (err) {
      throw new InternalServerErrorException('Error finding records', { cause: err });
    }
  }

  async findOne(id: number): Promise<RecordEntity> {
    const userId = this.request.user.sub;
    const isAdmin = this.request.user.role === UserRole.ADMIN;

    const record = await this.recordRepository.findOne({
      relations: [
        'addresses',
        'children',
        'financialAccounts',
        'documents',
        'identityDocuments',
        'user',
      ],
      where: isAdmin ? { id } : { id, userId },
    });
    if (!record) {
      throw new NotFoundException(`Record with ID ${id} not found`);
    }
    if (record.status === RecordStatus.DRAFT && record.userId !== userId) {
      throw new NotFoundException(`Record with ID ${id} not found`);
    }
    return record;
  }

  async findOnePublic(id: number): Promise<RecordEntity> {
    return this.toPublicRecord(await this.findOne(id));
  }

  async findOneByEmail(email: string): Promise<RecordEntity> {
    try {
      const record = await this.recordRepository.findOne({ where: { email } });
      if (!record) {
        throw new NotFoundException(`Record with email ${email} not found`);
      }
      return record;
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      throw new InternalServerErrorException('Error finding record by email', { cause: err });
    }
  }

  async remove(id: number): Promise<void> {
    const userId = this.request.user.sub;
    try {
      const record = await this.recordRepository.findOne({
        where: { id, userId },
        relations: ['documents'],
      });
      if (!record) {
        throw new NotFoundException(`Record with ID ${id} not found`);
      }
      const result = await this.recordRepository.delete({ id, userId });
      if (result.affected === 0) {
        throw new NotFoundException(`Record with ID ${id} not found`);
      }
      await this.storageService.deleteMany([
        record.profileImage,
        ...(record.documents ?? []).map((document) => document.file),
      ]);
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      throw new InternalServerErrorException('Error removing record', { cause: err });
    }
  }

  async reopen(
    id: number,
  ): Promise<{ id: number; status: RecordStatus; lastCompletedStep: number }> {
    const userId = this.request.user.sub;
    const isAdmin = this.request.user.role === UserRole.ADMIN;

    const record = await this.recordRepository.findOne({
      where: isAdmin ? { id } : { id, userId },
    });

    if (!record) {
      throw new NotFoundException(`Record with ID ${id} not found`);
    }

    record.status = RecordStatus.DRAFT;
    record.completedAt = null;
    record.updatedBy = userId;

    await this.recordRepository.save(record);

    return {
      id: record.id,
      status: record.status,
      lastCompletedStep: record.lastCompletedStep,
    };
  }

  async reembedDocuments(id: number): Promise<{ queued: number }> {
    const record = await this.findOne(id);
    const documentIds = (record.documents ?? []).map((document) => document.id);
    await this.documentIngestionQueueService.queueDocuments(documentIds);
    return { queued: documentIds.length };
  }

  async retryDocumentSearchIndex(
    recordId: number,
    documentIds: number[],
  ): Promise<{
    documentIds: number[];
    queued: number;
  }> {
    const record = await this.findOne(recordId);
    const uniqueDocumentIds = [...new Set(documentIds)];
    const recordDocumentIds = new Set(
      (record.documents ?? []).map((document) => document.id),
    );
    const missingDocumentId = uniqueDocumentIds.find(
      (documentId) => !recordDocumentIds.has(documentId),
    );

    if (missingDocumentId) {
      throw new NotFoundException('Document not found');
    }

    await this.documentIngestionQueueService.queueDocuments(uniqueDocumentIds);
    return {
      documentIds: uniqueDocumentIds,
      queued: uniqueDocumentIds.length,
    };
  }

  async uploadDocument(
    recordId: number,
    file: Express.Multer.File,
  ): Promise<{ url: string }> {
    const record = await this.findOne(recordId);
    this.ensureRecordEditable(record);
    const key = this.storageService.createDocumentKey(
      record.userId,
      recordId,
      file.originalname,
    );
    await this.storageService.upload(RECORD_DOCUMENTS_BUCKET, key, file);
    return { url: `/api/records/${recordId}/document-uploads/${key.split('/').pop()}` };
  }

  async getProfileImage(recordId: number): Promise<StoredObjectStream> {
    const record = await this.findOne(recordId);
    if (!this.storageService.parseReference(record.profileImage)) {
      throw new NotFoundException('Profile image not found');
    }
    return this.storageService.get(record.profileImage);
  }

  async getDocumentUpload(
    recordId: number,
    uploadId: string,
  ): Promise<StoredObjectStream> {
    const record = await this.findOne(recordId);
    const reference = this.storageService.toReference(
      RECORD_DOCUMENTS_BUCKET,
      `users/${record.userId}/records/${recordId}/documents/${uploadId}`,
    );
    return this.storageService.get(reference);
  }

  async getDocumentFile(
    recordId: number,
    documentId: number,
  ): Promise<StoredObjectStream> {
    const record = await this.findOne(recordId);
    const document = (record.documents ?? []).find((item) => item.id === documentId);
    if (!document || !this.storageService.parseReference(document.file)) {
      throw new NotFoundException('Document file not found');
    }
    return this.storageService.get(document.file);
  }

  private logRollback(step: number, error: unknown): void {
    this.logger.warn(
      `Rolling back step ${step}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  private determineStepSubmissionAction(
    status: RecordStatus | undefined,
    step: number,
  ): 'DRAFT' | 'CONTINUE' | 'FINAL' {
    if (!status) {
      return 'CONTINUE';
    }

    if (status === RecordStatus.DRAFT) {
      return 'DRAFT';
    }
    if (status === RecordStatus.COMPLETED) {
      if (step !== 6) {
        throw new BadRequestException(
          'COMPLETED status is only valid on step six final submission.',
        );
      }
      return 'FINAL';
    }

    throw new BadRequestException(
      'Invalid status. Allowed values are DRAFT or COMPLETED.',
    );
  }

  private ensureRecordEditable(record: RecordEntity) {
    if (record.status === RecordStatus.COMPLETED) {
      throw new BadRequestException(
        'Completed records are locked and cannot be edited.',
      );
    }
  }

  private normalizeNullableString(value: string | null | undefined): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private getDocumentMimeType(file?: string): string | null {
    const extension = extname(file?.split('?')[0] ?? '').toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.tif': 'image/tiff',
      '.tiff': 'image/tiff',
    };
    return mimeTypes[extension] ?? null;
  }

  private async promoteProfileImage(
    submittedProfileImage: string | undefined,
    userId: number,
    recordId: number,
    currentReference?: string,
  ): Promise<{
    reference: string | null;
    createdReference?: string;
    stagingReference?: string;
  }> {
    if (!submittedProfileImage) {
      return { reference: null };
    }
    if (
      submittedProfileImage === `/api/records/${recordId}/profile-image` ||
      submittedProfileImage === currentReference
    ) {
      return { reference: currentReference ?? null };
    }

    const uploadId = submittedProfileImage
      .split('?')[0]
      .split('/')
      .pop();
    if (!uploadId) {
      throw new BadRequestException('Invalid staged profile image');
    }
    const stagingKey = `profile-staging/users/${userId}/${uploadId}`;
    const stagingReference = this.storageService.toReference(
      TRANSIENT_BUCKET,
      stagingKey,
    );
    this.storageService.assertReferencePrefix(
      stagingReference,
      TRANSIENT_BUCKET,
      `profile-staging/users/${userId}/`,
    );
    if (!(await this.storageService.exists(stagingReference))) {
      throw new BadRequestException('Staged profile image was not found');
    }
    const destinationKey = this.storageService.createProfileKey(
      userId,
      recordId,
      uploadId,
    );
    const createdReference = await this.storageService.copy(
      stagingReference,
      PROFILE_IMAGES_BUCKET,
      destinationKey,
    );
    return {
      reference: createdReference,
      createdReference,
      stagingReference,
    };
  }

  private async resolveDocumentMetadata(
    submittedReference: string | undefined,
    userId: number,
    recordId: number,
    existingDocuments: Document[],
  ): Promise<{ file: string | null; size: number | null; uploadedAt?: Date }> {
    if (!submittedReference) {
      return { file: null, size: null };
    }

    const existingMatch = submittedReference.match(
      new RegExp(`^/api/records/${recordId}/documents/(\\d+)/file$`),
    );
    if (existingMatch) {
      const document = existingDocuments.find(
        (item) => item.id === Number(existingMatch[1]),
      );
      if (!document?.file) {
        throw new BadRequestException('Existing document was not found');
      }
      return {
        file: document.file,
        size: document.size ?? null,
        uploadedAt: document.uploadedAt,
      };
    }

    const uploadMatch = submittedReference.match(
      new RegExp(`^/api/records/${recordId}/document-uploads/([^/?]+)$`),
    );
    const reference = uploadMatch
      ? this.storageService.toReference(
          RECORD_DOCUMENTS_BUCKET,
          `users/${userId}/records/${recordId}/documents/${uploadMatch[1]}`,
        )
      : submittedReference;

    try {
      this.storageService.assertReferencePrefix(
        reference,
        RECORD_DOCUMENTS_BUCKET,
        `users/${userId}/records/${recordId}/documents/`,
      );
    } catch {
      throw new BadRequestException('Invalid document storage reference');
    }
    const metadata = await this.storageService.stat(reference);
    if (!metadata) {
      throw new BadRequestException('Uploaded document was not found');
    }
    return { file: reference, size: metadata.size ?? null };
  }

  private toPublicRecord(record: RecordEntity): RecordEntity {
    const publicRecord = Object.assign(
      Object.create(Object.getPrototypeOf(record)),
      record,
    ) as RecordEntity;
    publicRecord.profileImage = record.profileImage
      ? `/api/records/${record.id}/profile-image`
      : record.profileImage;
    publicRecord.documents = (record.documents ?? []).map((document) => ({
      ...document,
      file: document.file
        ? `/api/records/${record.id}/documents/${document.id}/file`
        : document.file,
    })) as typeof record.documents;
    return publicRecord;
  }

  private async applyStepAction(
    recordRepository: Repository<RecordEntity>,
    recordsId: number,
    step: number,
    action: 'DRAFT' | 'CONTINUE' | 'FINAL',
    actorUserId: number,
  ) {
    const record = await recordRepository.findOne({ where: { id: recordsId } });
    if (!record) {
      throw new NotFoundException(`Record with ID ${recordsId} not found`);
    }

    if (action === 'DRAFT') {
      if (record.status !== RecordStatus.COMPLETED) {
        record.status = RecordStatus.DRAFT;
      }
      record.updatedBy = actorUserId;
      await recordRepository.save(record);
      return;
    }

    if (action === 'FINAL') {
      record.status = RecordStatus.COMPLETED;
      record.lastCompletedStep = Math.max(record.lastCompletedStep, step);
      record.completedAt = new Date();
      record.updatedBy = actorUserId;
      await recordRepository.save(record);
      return;
    }

    record.status = RecordStatus.DRAFT;
    record.lastCompletedStep = Math.max(record.lastCompletedStep, step);
    record.completedAt = null;
    record.updatedBy = actorUserId;
    await recordRepository.save(record);
  }

  private async validateFinalSubmission(
    recordRepository: Repository<RecordEntity>,
    recordsId: number,
  ) {
    const record = await recordRepository.findOne({
      where: { id: recordsId },
      relations: ['documents', 'financialAccounts'],
    });

    if (!record) {
      throw new NotFoundException(`Record with ID ${recordsId} not found`);
    }

    const missingFields: string[] = [];
    if (!record.firstName) missingFields.push('firstName');
    if (!record.email) missingFields.push('email');

    if (missingFields.length > 0) {
      throw new BadRequestException({
        message: 'Final submission is incomplete.',
        missingFields,
      });
    }
  }
}
