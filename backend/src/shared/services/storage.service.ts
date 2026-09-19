import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import {
  RECORD_DOCUMENTS_BUCKET,
  PROFILE_IMAGES_BUCKET,
  TRANSIENT_BUCKET,
  TRANSIENT_RETENTION_MS,
} from '../constants/storage.constants';
import {
  StoredObjectReference,
  StoredObjectStream,
} from '../interfaces/stored-object.interface';
import { RedisService } from './redis.service';

const S3_REFERENCE_PREFIX = 's3://';
const STORAGE_DELETION_RETRY_KEY = 'storage:deletion-retry';

@Injectable()
export class StorageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {
    this.client = new S3Client({
      endpoint: this.configService.get<string>('S3_ENDPOINT') ?? 'http://minio:9000',
      region: this.configService.get<string>('S3_REGION') ?? 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId:
          this.configService.get<string>('S3_BACKEND_ACCESS_KEY') ?? '',
        secretAccessKey:
          this.configService.get<string>('S3_BACKEND_SECRET_KEY') ?? '',
      },
    });
  }

  onModuleInit(): void {
    this.cleanupTimer = setInterval(
      () => {
        void this.deleteExpiredTransientObjects().catch((error) =>
          this.logger.error('Failed to clean expired transient objects', error),
        );
        void this.retryFailedDeletions().catch((error) =>
          this.logger.error('Failed to retry storage deletions', error),
        );
      },
      60 * 60 * 1000,
    );
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.client.destroy();
  }

  createProfileStagingKey(userId: number, originalName: string): string {
    return `profile-staging/users/${userId}/${randomUUID()}${this.getSafeExtension(originalName)}`;
  }

  createProfileKey(userId: number, recordId: number, originalName: string): string {
    return `users/${userId}/records/${recordId}/profiles/${randomUUID()}${this.getSafeExtension(originalName)}`;
  }

  createDocumentKey(userId: number, recordId: number, originalName: string): string {
    return `users/${userId}/records/${recordId}/documents/${randomUUID()}${this.getSafeExtension(originalName)}`;
  }

  toReference(bucket: string, key: string): string {
    return `${S3_REFERENCE_PREFIX}${bucket}/${key}`;
  }

  parseReference(reference: string): StoredObjectReference | null {
    if (!reference?.startsWith(S3_REFERENCE_PREFIX)) {
      return null;
    }
    const path = reference.slice(S3_REFERENCE_PREFIX.length);
    const separator = path.indexOf('/');
    if (separator < 1 || separator === path.length - 1) {
      return null;
    }
    return { bucket: path.slice(0, separator), key: path.slice(separator + 1) };
  }

  assertReferencePrefix(reference: string, bucket: string, prefix: string): void {
    const parsed = this.parseReference(reference);
    if (!parsed || parsed.bucket !== bucket || !parsed.key.startsWith(prefix)) {
      throw new Error('Invalid storage reference');
    }
  }

  async upload(
    bucket: string,
    key: string,
    file: Express.Multer.File,
  ): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        Metadata: { originalname: encodeURIComponent(file.originalname) },
      }),
    );
    return this.toReference(bucket, key);
  }

  async uploadBuffer(
    bucket: string,
    key: string,
    buffer: Uint8Array,
    contentType: string,
  ): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
    return this.toReference(bucket, key);
  }

  async copy(
    sourceReference: string,
    destinationBucket: string,
    destinationKey: string,
  ): Promise<string> {
    const source = this.requireReference(sourceReference);
    await this.client.send(
      new CopyObjectCommand({
        Bucket: destinationBucket,
        Key: destinationKey,
        CopySource: encodeURI(`/${source.bucket}/${source.key}`),
        MetadataDirective: 'COPY',
      }),
    );
    return this.toReference(destinationBucket, destinationKey);
  }

  async exists(reference: string): Promise<boolean> {
    return (await this.stat(reference)) !== null;
  }

  async stat(reference: string): Promise<{ size?: number } | null> {
    const object = this.requireReference(reference);
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: object.bucket, Key: object.key }),
      );
      return { size: response.ContentLength };
    } catch (error) {
      // Only "does not exist" means null. Anything else (storage unreachable,
      // bad credentials) must not be reported to callers as a missing file.
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) {
        return null;
      }
      throw new ServiceUnavailableException(
        'File storage is temporarily unavailable.',
        { cause: error },
      );
    }
  }

  async get(reference: string): Promise<StoredObjectStream> {
    const object = this.requireReference(reference);
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: object.bucket, Key: object.key }),
    );
    if (!(response.Body instanceof Readable)) {
      throw new Error('Storage response is not a readable stream');
    }
    const encodedName = response.Metadata?.originalname;
    return {
      body: response.Body,
      contentLength: response.ContentLength,
      contentType: response.ContentType,
      originalName: encodedName ? decodeURIComponent(encodedName) : undefined,
    };
  }

  async delete(reference?: string): Promise<void> {
    const object = reference ? this.parseReference(reference) : null;
    if (!object) {
      return;
    }
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: object.bucket, Key: object.key }),
      );
    } catch (error) {
      this.logger.error(
        `Failed to delete storage object ${object.bucket}/${object.key}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.redisService
        .getClient()
        .lpush(STORAGE_DELETION_RETRY_KEY, reference)
        .catch(() => undefined);
      throw error;
    }
  }

  async deleteMany(references: Array<string | undefined>): Promise<void> {
    await Promise.all(
      references.filter(Boolean).map((reference) =>
        this.delete(reference).catch(() => undefined),
      ),
    );
  }

  private requireReference(reference: string): StoredObjectReference {
    const parsed = this.parseReference(reference);
    if (!parsed) {
      throw new Error('Invalid storage reference');
    }
    
    return parsed;
  }

  private getSafeExtension(originalName: string): string {
    const extension = extname(originalName).toLowerCase();
    return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '';
  }

  private async deleteExpiredTransientObjects(): Promise<void> {
    const cutoff = Date.now() - TRANSIENT_RETENTION_MS;
    let continuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: TRANSIENT_BUCKET,
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of page.Contents ?? []) {
        if (object.Key && object.LastModified && object.LastModified.getTime() < cutoff) {
          await this.delete(this.toReference(TRANSIENT_BUCKET, object.Key)).catch(
            () => undefined,
          );
        }
      }
      continuationToken = page.NextContinuationToken;
    } while (continuationToken);
  }

  private async retryFailedDeletions(): Promise<void> {
    for (let index = 0; index < 100; index += 1) {
      const reference = await this.redisService
        .getClient()
        .rpop(STORAGE_DELETION_RETRY_KEY);
      if (!reference) {
        return;
      }
      await this.delete(reference).catch(() => undefined);
    }
  }
}
