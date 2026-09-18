import { Inject, Injectable, Scope, ServiceUnavailableException } from '@nestjs/common';
import { RecordSearchFilterDto } from '../../records/dto/search/record-search-filter.dto';
import { RecordSearchResultDto } from '../../records/dto/search/record-search-result.dto';
import { Record as RecordEntity } from '../../records/entities/record.entity';
import { RecordQueryService } from '../../records/services/record-query.service';
import { AiChatResponseDto } from '../dto/ai-chat-response.dto';
import { RecordSummaryDto } from '../dto/record-summary.dto';
import { AiChatIntent } from '../enums/ai-chat-intent.enum';
import { LLM_CLIENT, LlmClient, LlmDeltaHandler } from '../llm/llm-client.interface';
import { RECORD_LIST_REPLY_PROMPT, RECORD_SUMMARY_PROMPT } from '../prompts/ai-chat.prompts';
import { DocumentHybridSearchService } from '../rag/document-hybrid-search.service';
import { StructuredRetrievalContextService } from './structured-retrieval-context.service';

const DEFAULT_RECORD_LIMIT = 10;
const MAX_RECORD_LIMIT = 50;

@Injectable({ scope: Scope.REQUEST })
export class StructuredRetrievalService {
  constructor(
    private readonly recordQueryService: RecordQueryService,
    @Inject(LLM_CLIENT) private readonly llmClient: LlmClient,
    private readonly contextService: StructuredRetrievalContextService,
    private readonly documentHybridSearchService: DocumentHybridSearchService,
  ) {}

  async getFilteredRecords(
    filters: RecordSearchFilterDto,
    onDelta?: LlmDeltaHandler,
  ): Promise<AiChatResponseDto> {
    const limit = this.getRecordLimit(filters.limit);
    const { records, total } = await this.recordQueryService.searchAccessibleRecords(
      filters,
      limit,
      0,
    );
    
    await this.contextService.setContext({ filters, limit, offset: 0, total });

    return {
      role: 'assistant',
      intent: AiChatIntent.RECORD_SEARCH,
      answer: await this.getRecordListAnswer(
        this.getSearchAnswer(total, records.length),
        { filters, total, offset: 0, records },
        onDelta,
      ),
      records,
      total,
    };
  }

  async getNextOrPreviousRecords(
    direction: 'next' | 'previous',
    requestedLimit?: number,
    onDelta?: LlmDeltaHandler,
  ): Promise<AiChatResponseDto> {
    const context = await this.contextService.getContext();
    const intent =
      direction === 'next'
        ? AiChatIntent.RECORD_NEXT_PAGE
        : AiChatIntent.RECORD_PREVIOUS_PAGE;

    if (!context) {
      return {
        role: 'assistant',
        intent,
        answer:
          'I do not have a previous record search to continue. Try searching first, for example “Show draft records.”',
        records: [],
        total: 0,
      };
    }

    const limit = requestedLimit
      ? this.getRecordLimit(requestedLimit)
      : context.limit;
    const offset =
      direction === 'next'
        ? context.offset + context.limit
        : Math.max(context.offset - limit, 0);
    const { records, total } = await this.recordQueryService.searchAccessibleRecords(
      context.filters,
      limit,
      offset,
    );
    await this.contextService.setContext({
      filters: context.filters,
      limit,
      offset,
      total,
    });

    return {
      role: 'assistant',
      intent,
      answer: await this.getRecordListAnswer(
        this.getPageAnswer(total, records.length, offset, direction),
        { filters: context.filters, total, offset, records },
        onDelta,
      ),
      records,
      total,
    };
  }

  async getRecordSummary(
    recordId?: number,
    filters?: RecordSearchFilterDto,
    onDelta?: LlmDeltaHandler,
  ): Promise<AiChatResponseDto> {
    if (!recordId && filters?.name) {
      const match = await this.findSingleRecordByName(filters.name);
      if (!match) {
        return this.getFilteredRecords({ name: filters.name }, onDelta);
      }
      recordId = match;
    }

    if (!recordId) {
      return {
        role: 'assistant',
        intent: AiChatIntent.RECORD_SUMMARY,
        answer:
          'Please include the record ID you want me to summarize, for example “Summarize record 151.”',
        records: [],
        total: 0,
      };
    }

    const record = await this.recordQueryService.findAccessibleRecord(recordId, [
      'documents',
      'financialAccounts',
      'identityDocuments',
      'addresses',
      'children',
    ]);
    
    const { chunks, truncated } = record.documents?.length
      ? await this.documentHybridSearchService.findRecordDocumentContent(recordId)
      : { chunks: [], truncated: false };
    const answer = await this.llmClient.chat(
      {
        systemPrompt: RECORD_SUMMARY_PROMPT,
        userContent: JSON.stringify({
          ...this.getRecordSummaryData(record),
          documentsTruncated: truncated,
          documentChunks: chunks.map(({ documentName, pageNumber, content }) => ({
            documentName,
            pageNumber,
            content,
          })),
        }),
        temperature: 0.2,
        unavailableMessage:
          'Recordly AI Assistant cannot summarize this record right now.',
      },
      onDelta,
    );

    if (!answer) {
      throw new ServiceUnavailableException(
        'Recordly AI Assistant cannot summarize this record right now.',
      );
    }

    return {
      role: 'assistant',
      intent: AiChatIntent.RECORD_SUMMARY,
      answer,
      records: [],
      total: 1,
      recordId,
      // One citation per document, not per chunk.
      citations: [
        ...new Map(
          chunks.map(({ documentId, recordId, documentName }) => [
            documentId,
            { documentId, recordId, documentName },
          ]),
        ).values(),
      ],
    };
  }

  /**
   * Writes a conversational reply for a record list. The templated answer is
   * used when there is nothing to describe or the model is unavailable, so a
   * working search never fails just because the narration did.
   */
  private async getRecordListAnswer(
    fallbackAnswer: string,
    result: {
      filters: RecordSearchFilterDto;
      total: number;
      offset: number;
      records: RecordSearchResultDto[];
    },
    onDelta?: LlmDeltaHandler,
  ): Promise<string> {
    if (result.records.length === 0) {
      return fallbackAnswer;
    }

    try {
      const answer = await this.llmClient.chat(
        {
          systemPrompt: RECORD_LIST_REPLY_PROMPT,
          userContent: JSON.stringify({
            filters: result.filters,
            total: result.total,
            shown: result.records.length,
            offset: result.offset,
            records: result.records.map((record) => ({
              id: record.id,
              name:
                [record.firstName, record.lastName].filter(Boolean).join(' ') ||
                `Record #${record.id}`,
              status: record.status,
              location: [record.city, record.state, record.country]
                .filter(Boolean)
                .join(', '),
            })),
          }),
          temperature: 0.4,
        },
        onDelta,
      );

      return answer || fallbackAnswer;
    } catch {
      return fallbackAnswer;
    }
  }

  /** Returns the record ID when the name matches exactly one accessible record. */
  private async findSingleRecordByName(name: string): Promise<number | undefined> {
    const { records, total } = await this.recordQueryService.searchAccessibleRecords(
      { name },
      1,
      0,
    );

    return total === 1 ? records[0].id : undefined;
  }

  private getRecordLimit(limit?: number): number {
    if (!limit || !Number.isFinite(limit) || limit < 1) {
      return DEFAULT_RECORD_LIMIT;
    }

    return Math.min(Math.floor(limit), MAX_RECORD_LIMIT);
  }

  private getRecordSummaryData(record: RecordEntity): RecordSummaryDto {
    return {
      id: record.id,
      name:
        [record.firstName, record.lastName].filter(Boolean).join(' ') ||
        `Record #${record.id}`,
      status: record.status,
      contact: record.email || record.mobileNumber || 'Not saved',
      location:
        [record.city, record.state, record.country]
          .filter(Boolean)
          .join(', ') || 'Not saved',
      documentsCount: record.documents?.length ?? 0,
      documentNames: (record.documents ?? [])
        .map((document) => document.name)
        .filter(Boolean),
      identityDocumentsCount: record.identityDocuments?.length ?? 0,
      identityDocumentTypes: (record.identityDocuments ?? [])
        .map((identityDocument) => identityDocument.type)
        .filter(Boolean),
      financialAccountsCount: record.financialAccounts?.length ?? 0,
      financialAccountTypes: (record.financialAccounts ?? [])
        .map((financialAccount) => financialAccount.type)
        .filter(Boolean),
      addressesCount: record.addresses?.length ?? 0,
      childrenCount: record.children?.length ?? 0,
      redirectedAddressEnabled: Boolean(
        record.isRedirected || record.redirectionAddress,
      ),
      abroad: Boolean(record.isAbroad),
      lastCompletedStep: record.lastCompletedStep,
    };
  }

  private getSearchAnswer(total: number, shown: number): string {
    if (total === 0) {
      return 'I could not find any matching records.';
    }
    if (total > shown) {
      return `I found ${total} matching records. Showing the first ${shown}.`;
    }
    return `I found ${total} matching ${total === 1 ? 'record' : 'records'}.`;
  }

  private getPageAnswer(
    total: number,
    shown: number,
    offset: number,
    direction: 'next' | 'previous',
  ): string {
    if (shown === 0) {
      return direction === 'next'
        ? 'There are no more matching records to show.'
        : 'You are already at the beginning of the matching records.';
    }
    return `Showing records ${offset + 1}-${offset + shown} of ${total}.`;
  }
}
