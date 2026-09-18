import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Scope,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { AuthenticatedRequest } from '../../auth/types/express';
import { UserRole } from '../../users/enums/user-role.enum';
import { RecordSearchFilterDto } from '../dto/search/record-search-filter.dto';
import { RecordSearchResultDto } from '../dto/search/record-search-result.dto';
import { Record as RecordEntity } from '../entities/record.entity';
import { RecordStatus } from '../enums/record-status.enum';

@Injectable({ scope: Scope.REQUEST })
export class RecordQueryService {
  constructor(
    @Inject(REQUEST)
    private readonly request: AuthenticatedRequest,
    @InjectRepository(RecordEntity)
    private readonly recordRepository: Repository<RecordEntity>,
  ) {}

  guardQueryAccess<T extends ObjectLiteral>(
    query: SelectQueryBuilder<T>,
    recordAlias = 'record',
  ): void {
    const userId = this.request.user.sub;
    if (this.request.user.role === UserRole.ADMIN) {
      query.andWhere(
        new Brackets((qb) => {
          qb.where(`${recordAlias}.status != :accessibleDraftStatus`, {
            accessibleDraftStatus: RecordStatus.DRAFT,
          }).orWhere(`${recordAlias}.userId = :accessibleUserId`, {
            accessibleUserId: userId,
          });
        }),
      );
      
      return;
    }

    query.andWhere(`${recordAlias}.userId = :accessibleUserId`, {
      accessibleUserId: userId,
    });
  }

  async searchAccessibleRecords(
    filters: RecordSearchFilterDto,
    limit: number,
    offset: number,
  ): Promise<{ records: RecordSearchResultDto[]; total: number }> {
    try {
      const query = this.recordRepository
        .createQueryBuilder('record')
        .leftJoin('record.documents', 'documents')
        .leftJoin('record.financialAccounts', 'financialAccounts')
        .leftJoin('record.identityDocuments', 'identityDocuments')
        .select([
          'record.id',
          'record.firstName',
          'record.lastName',
          'record.email',
          'record.mobileNumber',
          'record.status',
          'record.city',
          'record.state',
          'record.country',
          'record.createdAt',
        ])
        .distinct(true)
        .orderBy('record.createdAt', 'DESC')
        .skip(offset)
        .take(limit);

      this.guardQueryAccess(query);
      this.applyRecordSearchFilters(query, filters);
      const [records, total] = await query.getManyAndCount();

      return {
        records: records.map((record) => this.toRecordSearchResult(record)),
        total,
      };
    } catch (error) {
      console.error('Error searching accessible records:', error);
      throw new InternalServerErrorException('Error searching records');
    }
  }

  async findAccessibleRecord(
    recordId: number,
    relations: string[] = [],
  ): Promise<RecordEntity> {
    const query = this.recordRepository
      .createQueryBuilder('record')
      .where('record.id = :recordId', { recordId });

    for (const relation of relations) {
      query.leftJoinAndSelect(`record.${relation}`, relation);
    }

    this.guardQueryAccess(query);
    const record = await query.getOne();
    if (!record) {
      throw new NotFoundException(`Record with ID ${recordId} not found`);
    }
    return record;
  }

  toRecordSearchResult(record: RecordEntity): RecordSearchResultDto {
    return {
      id: record.id,
      firstName: record.firstName,
      lastName: record.lastName,
      email: record.email,
      mobileNumber: record.mobileNumber,
      status: record.status,
      city: record.city,
      state: record.state,
      country: record.country,
    };
  }

  private applyRecordSearchFilters(
    query: SelectQueryBuilder<RecordEntity>,
    filters: RecordSearchFilterDto,
  ): void {
    if (filters.status) {
      query.andWhere('record.status = :status', { status: filters.status });
    }

    if (filters.search) {
      query.andWhere(
        new Brackets((qb) => {
          qb.where('record.firstName ILIKE :search', {
            search: `%${filters.search}%`,
          });
          for (const field of [
            'lastName',
            'email',
            'mobileNumber',
            'city',
            'state',
            'country',
          ]) {
            qb.orWhere(`record.${field} ILIKE :search`, {
              search: `%${filters.search}%`,
            });
          }
        }),
      );
    }

    // Each word must match the first or last name, so "Ervin Smitham" finds
    // firstName "Ervin" + lastName "Smitham".
    (filters.name?.split(/\s+/).filter(Boolean) ?? []).forEach((word, index) => {
      query.andWhere(
        new Brackets((qb) => {
          qb.where(`record.firstName ILIKE :nameWord${index}`, {
            [`nameWord${index}`]: `%${word}%`,
          }).orWhere(`record.lastName ILIKE :nameWord${index}`, {
            [`nameWord${index}`]: `%${word}%`,
          });
        }),
      );
    });

    for (const key of ['email', 'mobileNumber', 'city', 'state', 'country'] as const) {
      if (filters[key]) {
        query.andWhere(`record.${key} ILIKE :${key}`, {
          [key]: `%${filters[key]}%`,
        });
      }
    }

    if (filters.postalCode) {
      query.andWhere('record.postalCode ILIKE :postalCode', {
        postalCode: `%${filters.postalCode}%`,
      });
    }

    for (const { key, alias, column } of [
      { key: 'identityDocumentType', alias: 'identityDocuments', column: 'type' },
      { key: 'financialAccountType', alias: 'financialAccounts', column: 'type' },
      { key: 'financialAccountProvider', alias: 'financialAccounts', column: 'provider' },
    ] as const) {
      if (filters[key]) {
        query.andWhere(`${alias}.${column} ILIKE :${key}`, {
          [key]: `%${filters[key]}%`,
        });
      }
    }

    for (const key of ['isRedirected', 'isAbroad'] as const) {
      if (typeof filters[key] === 'boolean') {
        query.andWhere(`record.${key} = :${key}`, { [key]: filters[key] });
      }
    }

    if (typeof filters.hasDocuments === 'boolean') {
      query.andWhere(
        filters.hasDocuments ? 'documents.id IS NOT NULL' : 'documents.id IS NULL',
      );
    }

    if (typeof filters.hasFinancialAccounts === 'boolean') {
      query.andWhere(
        filters.hasFinancialAccounts
          ? 'financialAccounts.id IS NOT NULL'
          : 'financialAccounts.id IS NULL',
      );
    }
  }
}
