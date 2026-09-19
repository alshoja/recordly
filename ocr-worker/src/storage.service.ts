import {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

type StoredObjectReference = { bucket: string; key: string };

@Injectable()
export class StorageService implements OnModuleDestroy {
  private readonly client = new S3Client({
    endpoint: process.env.S3_ENDPOINT || 'http://minio:9000',
    region: process.env.S3_REGION || 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_OCR_ACCESS_KEY || '',
      secretAccessKey: process.env.S3_OCR_SECRET_KEY || '',
    },
  });

  onModuleDestroy(): void {
    this.client.destroy();
  }

  async downloadToTempFile(reference: string): Promise<string> {
    const object = this.parseReference(reference);
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: object.bucket, Key: object.key }),
    );
    if (!(response.Body instanceof Readable)) {
      throw new Error('Storage response is not a readable stream');
    }
    const directory = join(tmpdir(), 'recordly-ocr');
    await mkdir(directory, { recursive: true });
    const filePath = join(directory, `${randomUUID()}${extname(object.key)}`);
    try {
      await pipeline(response.Body, createWriteStream(filePath));
    } catch (error) {

      await rm(filePath, { force: true });
      throw error;
    }
    return filePath;
  }

  async delete(reference: string): Promise<void> {
    const object = this.parseReference(reference);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: object.bucket, Key: object.key }),
    );
  }

  private parseReference(reference: string): StoredObjectReference {
    if (!reference?.startsWith('s3://')) {
      throw new Error('Invalid storage reference');
    }
    const path = reference.slice('s3://'.length);
    const separator = path.indexOf('/');
    if (separator < 1 || separator === path.length - 1) {
      throw new Error('Invalid storage reference');
    }
    return { bucket: path.slice(0, separator), key: path.slice(separator + 1) };
  }
}
