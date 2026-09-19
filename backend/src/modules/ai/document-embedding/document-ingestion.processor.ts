import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { DOCUMENT_EMBEDDING_QUEUE } from '../../../shared/constants/document-embedding.constants';
import { Document } from '../../records/entities/document.entity';
import { DocumentChunkingService } from './services/document-chunking.service';
import { DocumentIngestionService } from './services/document-ingestion.service';
import { DocumentParserService } from './services/document-parser.service';
import { DocumentSearchIndexingService } from './services/document-search-indexing.service';

@Processor(DOCUMENT_EMBEDDING_QUEUE, { concurrency: 1 })
export class DocumentIngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentIngestionProcessor.name);

  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    private readonly documentParserService: DocumentParserService,
    private readonly documentChunkingService: DocumentChunkingService,
    private readonly documentIngestionService: DocumentIngestionService,
    private readonly documentSearchIndexingService: DocumentSearchIndexingService,
  ) {
    super();
  }

  // BullMQ keeps failed jobs in Redis but writes nothing to the app log, so a
  // failed job would otherwise be invisible.
  @OnWorkerEvent('failed')
  onFailed(job: Job<{ documentId: number }> | undefined, error: Error): void {
    this.logger.error(
      `Ingestion job ${job?.id} for document ${job?.data.documentId} failed (attempt ${job?.attemptsMade}/${job?.opts.attempts}): ${error.message}`,
      error.stack,
    );
  }

  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error(`Ingestion worker error: ${error.message}`, error.stack);
  }

  async process(job: Job<{ documentId: number }>): Promise<void> {
    const document = await this.documentRepository.findOne({
      where: { id: job.data.documentId },
      relations: { records: true },
    });
    if (!document) {
      this.logger.warn(
        `Skipping ingestion job ${job.id}: document ${job.data.documentId} no longer exists`,
      );
      return;
    }

    await this.documentIngestionService.markDocumentIngestionStarted(
      document.id,
    );

    try {
      await this.documentIngestionService.deleteSavedDocumentChunks(
        document.id,
      );

      // Only delete from search index if enabled, otherwise it will be a no-op but will still consume time
      if (this.documentSearchIndexingService.isEnabled()) {
        await this.documentSearchIndexingService.ensureDocumentChunkIndex();
        await this.documentSearchIndexingService.deleteIndexedDocumentChunks(
          document.id,
        );
      }

      const pages = await this.documentParserService.extract(document.file);
      const chunks = this.documentChunkingService.prepareDocumentChunks(pages);
      if (chunks.length === 0) {
        throw new Error('No usable text was found in this document');
      }

      await this.documentIngestionService.ingestDocumentChunks(
        document,
        chunks,
      );

      await this.documentIngestionService.markDocumentIngestionCompleted(
        document.id,
        this.documentChunkingService.createDocumentChunksHash(chunks),
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message.slice(0, 1000)
          : 'Document indexing failed';
      await this.documentIngestionService.markDocumentIngestionFailed(
        document.id,
        error,
        errorMessage,
      );
      throw error;
    }
  }
}
