import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as tesseract from 'tesseract.js';
import { promises as fs } from 'node:fs';
import { StorageService } from './storage.service';
import { OCR_IMAGE_TEXT_EXTRACTION_JOB } from './queue.constants';

type OcrJobData = {
  storageReference?: string;
  deleteAfterProcessing?: boolean;
  userId?: string;
};

@Processor(process.env.OCR_QUEUE_NAME, { concurrency: 1 })
export class OcrProcessor extends WorkerHost {
  private readonly logger = new Logger(OcrProcessor.name);

  constructor(private readonly storageService: StorageService) {
    super();
  }


  @OnWorkerEvent('failed')
  onFailed(job: Job<OcrJobData> | undefined, error: Error): void {
    this.logger.error(
      `OCR job ${job?.id} failed: ${error.message}`,
      error.stack,
    );
  }

  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error(`OCR worker error: ${error.message}`, error.stack);
  }

  async process(job: Job<OcrJobData>): Promise<any> {
    const { storageReference, deleteAfterProcessing } = job.data || {};
    let filePath: string | undefined;

    try {
      if (!storageReference) {
        throw new Error('Missing storage reference in OCR job payload');
      }

      filePath = await this.storageService.downloadToTempFile(storageReference);

      switch (job.name) {
        case OCR_IMAGE_TEXT_EXTRACTION_JOB: {
          this.logger.log(`Running OCR for job ${job.id}`);
          const {
            data: { text },
          } = await tesseract.recognize(filePath, 'eng');
          return { text: this.normalizeOcrText(text) };
        }
        default: {
          throw new Error(`Unsupported OCR job name: ${job.name}`);
        }
      }
    } finally {
      if (filePath) {
        await fs.unlink(filePath).catch(() => undefined);
      }
      if (deleteAfterProcessing && storageReference) {
        await this.storageService.delete(storageReference).catch((error) => {
          this.logger.error(
            `Failed to delete transient OCR object for job ${job.id}: ${error?.message}`,
            error?.stack,
          );
        });
      }
    }
  }

  private normalizeOcrText(rawText: string): string {
    return rawText
      .replace(/\r/g, '\n')
      .replace(/[|]/g, 'I')
      .replace(/SIO/g, 'S/O')
      .replace(/DIO/g, 'D/O')
      .replace(/WIO/g, 'W/O')
      .replace(/[^\x20-\x7E\n]/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n+/g, '\n')
      .trim();
  }
}
