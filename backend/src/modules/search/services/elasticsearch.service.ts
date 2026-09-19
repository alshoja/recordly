import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, estypes } from '@elastic/elasticsearch';
import { DocumentChunkIndexPayload } from '../interfaces/document-chunk-index.interface';

export interface DocumentChunkBm25SearchResult {
  chunkId: number;
  score: number;
}

@Injectable()
export class ElasticsearchService implements OnModuleInit {
  private readonly logger = new Logger(ElasticsearchService.name);
  private readonly enabled: boolean;
  private readonly indexName: string;
  private readonly node: string;
  private readonly client?: Client;

  constructor(private readonly configService: ConfigService) {
    this.enabled =
      this.configService.get<boolean>('config.documentSearchHybridEnabled') ??
      false;
    this.indexName =
      this.configService.get<string>('config.elasticsearchIndex') ||
      'document_chunks';
    this.node =
      this.configService.get<string>('config.elasticsearchNode') ||
      'http://elasticsearch:9200';

    if (this.enabled) {
      this.client = new Client({
        node: this.node,
      });
    }
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log(
        'BM25 search is disabled; Elasticsearch client is not active.',
      );
      return;
    }

    const isAvailable = await this.ping();
    if (isAvailable) {
      this.logger.log(
        `Elasticsearch is reachable at ${this.node}; using index "${this.indexName}".`,
      );
      await this.ensureDocumentChunkIndex();
      return;
    }

    this.logger.warn(
      `Elasticsearch is enabled but not reachable at ${this.node}.`,
    );
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getIndexName(): string {
    return this.indexName;
  }

  async indexDocumentChunk(payload: DocumentChunkIndexPayload): Promise<void> {
    if (!this.client) {
      return;
    }

    await this.client.index({
      index: this.indexName,
      id: String(payload.chunkId),
      document: payload,
      refresh: false,
    });
  }

  async deleteDocumentChunksForDocument(documentId: number): Promise<void> {
    if (!this.client) {
      return;
    }

    await this.client.deleteByQuery({
      index: this.indexName,
      conflicts: 'proceed',
      query: {
        term: {
          documentId,
        },
      },
      refresh: true,
    });
  }

  async searchDocumentChunks(
    query: string,
    limit: number,
    recordId?: number,
  ): Promise<DocumentChunkBm25SearchResult[]> {
    if (!this.client) {
      return [];
    }

    const filter: estypes.QueryDslQueryContainer[] = [];
    if (recordId) {
      filter.push({ term: { recordId } });
    }

    const response = await this.client.search<DocumentChunkIndexPayload>({
      index: this.indexName,
      size: limit,
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query,
                fields: [
                  'content^4',
                  'documentName^2',
                  'firstName',
                  'lastName',
                  'city',
                  'state',
                  'country',
                ],
              },
            },
          ],
          filter,
        },
      },
    });

    return response.hits.hits
      .map((hit) => ({
        chunkId: hit._source?.chunkId,
        score: hit._score ?? 0,
      }))
      .filter(
        (result): result is DocumentChunkBm25SearchResult =>
          typeof result.chunkId === 'number',
      );
  }

  async ensureDocumentChunkIndex(): Promise<void> {
    if (!this.client) {
      return;
    }

    const exists = await this.client.indices.exists({
      index: this.indexName,
    });

    if (exists) {
      this.logger.log(`Elasticsearch index "${this.indexName}" already exists.`);
      return;
    }

    await this.client.indices.create({
      index: this.indexName,
      mappings: this.getDocumentChunkIndexMapping(),
    });

    this.logger.log(`Elasticsearch index "${this.indexName}" created.`);
  }

  async ping(): Promise<boolean> {
    if (!this.client) {
      return false;
    }

    try {
      return await this.client.ping();
    } catch (error) {
      this.logger.warn(
        `Elasticsearch ping failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private getDocumentChunkIndexMapping(): estypes.MappingTypeMapping {
    const searchableTextField: estypes.MappingProperty = {
      type: 'text',
      fields: {
        keyword: {
          type: 'keyword',
          ignore_above: 256,
        },
      },
    };

    return {
      properties: {
        chunkId: { type: 'integer' },
        documentId: { type: 'integer' },
        recordId: { type: 'integer' },
        chunkIndex: { type: 'integer' },
        pageNumber: { type: 'integer' },
        content: { type: 'text' },
        documentName: searchableTextField,
        recordStatus: { type: 'keyword' },
        firstName: searchableTextField,
        lastName: searchableTextField,
        email: { type: 'keyword' },
        mobileNumber: { type: 'keyword' },
        city: searchableTextField,
        state: searchableTextField,
        country: searchableTextField,
        createdAt: { type: 'date' },
      },
    };
  }
}
