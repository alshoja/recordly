import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ExistsRule } from 'src/shared/validators/exist-rule.validator';
import { ValidateFile } from './validators/file.validator';
import { BullModule } from '@nestjs/bullmq';
import { OcrService } from './services/ocr.service';
import { RedisModule } from './redis.module';
import { OCR_QUEUE } from './constants/queue.constants';
import { EncryptionConfigService } from './services/encryption-config.service';
import { StorageService } from './services/storage.service';

@Module({
  imports: [
    ConfigModule,
    RedisModule,
    BullModule.registerQueue({
      name: OCR_QUEUE,
      // Finished jobs are kept briefly instead of being removed at once: the
      // backend can start waiting for a job that has already finished, and then
      // reads its result or failure reason from the stored job. A completed job
      // holds the extracted document text, so it must not stay in Redis long.
      defaultJobOptions: {
        removeOnComplete: { age: 300 },
        removeOnFail: { age: 3600 },
      },
    }),
  ],
  providers: [
    ExistsRule,
    ValidateFile,
    OcrService,
    EncryptionConfigService,
    StorageService,
  ],
  exports: [ExistsRule, ValidateFile, OcrService, StorageService, RedisModule],
})
export class SharedModule { }
