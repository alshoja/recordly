import { Injectable, Logger, Scope } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { formatPgVector } from '../../../shared/utilities/vector.utility';
import { ElasticsearchService } from '../../search/services/elasticsearch.service';
import { DocumentChunk } from '../../records/entities/document-chunk.entity';
import { Document } from '../../records/entities/document.entity';
import { Record as RecordEntity } from '../../records/entities/record.entity';
import { RecordStatus } from '../../records/enums/record-status.enum';
import { RecordQueryService } from '../../records/services/record-query.service';
import { RetrievedDocumentChunkDto } from '../dto/retrieved-document-chunk.dto';

const DOCUMENT_CHUNK_LIMIT = 8;
const SUMMARY_CHUNK_LIMIT = 200;
const SUMMARY_CHARACTER_LIMIT = 30_000;
const DISTANCE_THRESHOLD = 0.8;

interface VectorSearchResult {
  chunkId: number;
  rank: number;
}

export interface RecordDocumentContent {
  chunks: RetrievedDocumentChunkDto[];
  truncated: boolean;
}

interface HybridScore {
  chunkId: number;
  vectorScore: number;
  bm25Score: number;
  finalScore: number;
}

@Injectable({ scope: Scope.REQUEST })
export class DocumentHybridSearchService {
  private readonly logger = new Logger(DocumentHybridSearchService.name);

  constructor(
    @InjectRepository(DocumentChunk)
    private readonly documentChunkRepository: Repository<DocumentChunk>,
    private readonly configService: ConfigService,
    private readonly elasticsearchService: ElasticsearchService,
    private readonly recordQueryService: RecordQueryService,
  ) {}

  async findRecordDocumentChunks(
    question: string,
    embedding: number[],
    recordId?: number,
  ): Promise<RetrievedDocumentChunkDto[]> {
    const vectorResults = await this.findVectorChunkIds(embedding, recordId);

    if (!this.elasticsearchService.isEnabled()) {
      this.logger.debug('BM25 search is disabled; using vector-only document search.');
      return this.findAuthorizedChunksByIds(
        vectorResults.map((result) => result.chunkId),
        recordId,
      );
    }

    try {
      this.logger.debug('BM25 search is enabled; using hybrid document search.');
      const bm25Results = await this.elasticsearchService.searchDocumentChunks(
        question,
        this.getBm25ResultLimit(),
        recordId,
      );
      const rankedChunkIds = this.rankHybridChunkIds(vectorResults, bm25Results);
      return this.findAuthorizedChunksByIds(rankedChunkIds, recordId);
    } catch (error) {
      this.logger.warn(
        `BM25 search failed; falling back to vector-only document search: ${this.getErrorMessage(error)}`,
      );
      return this.findAuthorizedChunksByIds(
        vectorResults.map((result) => result.chunkId),
        recordId,
      );
    }
  }

  private async findVectorChunkIds(
    embedding: number[],
    recordId?: number,
  ): Promise<VectorSearchResult[]> {
    const vector = formatPgVector(embedding);
    const query = this.buildAuthorizedChunkQuery(recordId)
      .select('chunk.id', 'chunkId')
      .andWhere('(chunk.embedding <=> CAST(:embedding AS vector)) < :threshold', {
        embedding: vector,
        threshold: DISTANCE_THRESHOLD,
      })
      .orderBy('chunk.embedding <=> CAST(:embedding AS vector)', 'ASC')
      .limit(DOCUMENT_CHUNK_LIMIT);

    const rows = await query.getRawMany<Record<string, unknown>>();
    return rows.map((row, index) => ({
      chunkId: Number(row.chunkId),
      rank: index + 1,
    }));
  }

  private async findAuthorizedChunksByIds(
    chunkIds: number[],
    recordId?: number,
  ): Promise<RetrievedDocumentChunkDto[]> {
    if (chunkIds.length === 0) {
      return [];
    }

    const uniqueChunkIds = [...new Set(chunkIds)].slice(0, DOCUMENT_CHUNK_LIMIT);
    const query = this.selectChunkColumns(
      this.buildAuthorizedChunkQuery(recordId),
    ).andWhere('chunk.id IN (:...chunkIds)', { chunkIds: uniqueChunkIds });

    const rows = await query.getRawMany<Record<string, unknown>>();
    const rowsByChunkId = new Map(
      rows.map((row) => [Number(row.chunkId), this.mapChunkRow(row)]),
    );

    return uniqueChunkIds
      .map((chunkId) => rowsByChunkId.get(chunkId))
      .filter((chunk): chunk is RetrievedDocumentChunkDto => Boolean(chunk));
  }

  /**
   * Returns the document text of one record in reading order, for summaries.
   * Stops at a character budget so the model prompt stays bounded.
   */
  async findRecordDocumentContent(recordId: number): Promise<RecordDocumentContent> {
    const rows = await this.selectChunkColumns(
      this.buildAuthorizedChunkQuery(recordId),
    )
      .orderBy('chunk.documentId', 'ASC')
      .addOrderBy('chunk.chunkIndex', 'ASC')
      .limit(SUMMARY_CHUNK_LIMIT + 1)
      .getRawMany<Record<string, unknown>>();

    const chunks: RetrievedDocumentChunkDto[] = [];
    let characters = 0;
    for (const row of rows.slice(0, SUMMARY_CHUNK_LIMIT)) {
      const chunk = this.mapChunkRow(row);
      if (characters + chunk.content.length > SUMMARY_CHARACTER_LIMIT) {
        return { chunks, truncated: true };
      }
      characters += chunk.content.length;
      chunks.push(chunk);
    }

    return { chunks, truncated: rows.length > SUMMARY_CHUNK_LIMIT };
  }

  private selectChunkColumns(
    query: SelectQueryBuilder<DocumentChunk>,
  ): SelectQueryBuilder<DocumentChunk> {
    return query
      .select('chunk.id', 'chunkId')
      .addSelect('chunk.documentId', 'documentId')
      .addSelect('chunk.recordsId', 'recordId')
      .addSelect('chunk.pageNumber', 'pageNumber')
      .addSelect('chunk.content', 'content')
      .addSelect('document.name', 'documentName')
      .addSelect('record.firstName', 'firstName')
      .addSelect('record.lastName', 'lastName')
      .addSelect('record.email', 'email')
      .addSelect('record.mobileNumber', 'mobileNumber')
      .addSelect('record.status', 'status')
      .addSelect('record.city', 'city')
      .addSelect('record.state', 'state')
      .addSelect('record.country', 'country');
  }

  private buildAuthorizedChunkQuery(
    recordId?: number,
  ): SelectQueryBuilder<DocumentChunk> {
    const query = this.documentChunkRepository
      .createQueryBuilder('chunk')
      .innerJoin(Document, 'document', 'document.id = chunk.documentId')
      .innerJoin(RecordEntity, 'record', 'record.id = chunk.recordsId');

    this.recordQueryService.guardQueryAccess(query, 'record');
    if (recordId) {
      query.andWhere('record.id = :recordId', { recordId });
    }

    return query;
  }

  private rankHybridChunkIds(
    vectorResults: VectorSearchResult[],
    bm25Results: { chunkId: number }[],
  ): number[] {
    // Vector distance and Elasticsearch _score use different scales, so compare
    // ranks instead: rank #1 = 1, rank #2 = 0.5, then apply configured weights.
    const scores = new Map<number, HybridScore>();
    const vectorWeight = this.getVectorWeight();
    const bm25Weight = this.getBm25Weight();

    for (const result of vectorResults) {
      const vectorScore = this.getRankScore(result.rank);
      scores.set(result.chunkId, {
        chunkId: result.chunkId,
        vectorScore,
        bm25Score: 0,
        finalScore: vectorScore * vectorWeight,
      });
    }

    bm25Results.forEach((result, index) => {
      const existing = scores.get(result.chunkId);
      const bm25Score = this.getRankScore(index + 1);
      scores.set(result.chunkId, {
        chunkId: result.chunkId,
        vectorScore: existing?.vectorScore ?? 0,
        bm25Score,
        finalScore:
          (existing?.vectorScore ?? 0) * vectorWeight + bm25Score * bm25Weight,
      });
    });

    return [...scores.values()]
      .sort((left, right) => right.finalScore - left.finalScore)
      .slice(0, DOCUMENT_CHUNK_LIMIT)
      .map((score) => score.chunkId);
  }

  private mapChunkRow(row: Record<string, unknown>): RetrievedDocumentChunkDto {
    return {
      documentId: Number(row.documentId),
      recordId: Number(row.recordId),
      documentName: String(row.documentName || 'Uploaded document'),
      pageNumber: row.pageNumber ? Number(row.pageNumber) : undefined,
      content: String(row.content),
      firstName: this.getString(row.firstName),
      lastName: this.getString(row.lastName),
      email: this.getString(row.email),
      mobileNumber: this.getString(row.mobileNumber),
      status: this.getStatus(row.status),
      city: this.getString(row.city),
      state: this.getString(row.state),
      country: this.getString(row.country),
    };
  }

  private getRankScore(rank: number): number {
    return 1 / rank;
  }

  private getVectorWeight(): number {
    return this.configService.get<number>('config.documentSearchVectorWeight') ?? 0.6;
  }

  private getBm25Weight(): number {
    return this.configService.get<number>('config.documentSearchBm25Weight') ?? 0.4;
  }

  private getBm25ResultLimit(): number {
    return (
      this.configService.get<number>('config.documentSearchBm25ResultLimit') ?? 20
    );
  }

  private getString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private getStatus(value: unknown): RecordStatus | undefined {
    return value === RecordStatus.DRAFT || value === RecordStatus.COMPLETED
      ? value
      : undefined;
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown Elasticsearch error';
  }
}
