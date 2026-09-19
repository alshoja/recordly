import { Inject, Injectable, Logger, Scope } from '@nestjs/common';
import { RecordSearchFilterDto } from '../../records/dto/search/record-search-filter.dto';
import { RecordStatus } from '../../records/enums/record-status.enum';
import { AiChatIntentDto } from '../dto/ai-chat-intent.dto';
import { AiChatResponseDto } from '../dto/ai-chat-response.dto';
import { AiChatIntent } from '../enums/ai-chat-intent.enum';
import { LLM_CLIENT, LlmClient, LlmDeltaHandler } from '../llm/llm-client.interface';
import { RECORD_INTENT_PROMPT } from '../prompts/ai-chat.prompts';
import { RecordRagService } from '../rag/record-rag.service';
import { StructuredRetrievalService } from '../structured-retrieval/structured-retrieval.service';

// Filters that only match record fields by text. Anything else (status, city,
// abroad, ...) is a structured request that documents cannot answer.
const TEXT_FILTER_KEYS = ['name', 'search', 'email', 'mobileNumber'];

@Injectable({ scope: Scope.REQUEST })
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);

  constructor(
    @Inject(LLM_CLIENT) private readonly llmClient: LlmClient,
    private readonly recordRagService: RecordRagService,
    private readonly structuredRetrievalService: StructuredRetrievalService,
  ) { }

  async ask(
    message: string,
    onDelta?: LlmDeltaHandler,
  ): Promise<AiChatResponseDto> {
    const recordIntent = await this.getRecordIntent(message);

    switch (recordIntent.intent) {
      case AiChatIntent.RECORD_SEARCH:
        return this.searchRecordsThenDocuments(message, recordIntent.filters ?? {}, onDelta);
      case AiChatIntent.RECORD_NEXT_PAGE:
        return this.structuredRetrievalService.getNextOrPreviousRecords('next', recordIntent.filters?.limit, onDelta);
      case AiChatIntent.RECORD_PREVIOUS_PAGE:
        return this.structuredRetrievalService.getNextOrPreviousRecords('previous', recordIntent.filters?.limit, onDelta);
      case AiChatIntent.RECORD_SUMMARY:
        return this.summarizeRecordThenSearchDocuments(message, recordIntent, onDelta);
      case AiChatIntent.DOCUMENT_QUESTION:
        return this.recordRagService.searchInRecord(message, recordIntent.recordId, onDelta);
      case AiChatIntent.DOCUMENT_SEARCH:
        return this.recordRagService.searchRecords(message, onDelta);
      case AiChatIntent.UNSUPPORTED:
      default:
        return {
          role: 'assistant',
          intent: AiChatIntent.UNSUPPORTED,
          answer:
            'I can help you find records, summarize records, or answer questions using uploaded documents.',
          records: [],
          total: 0,
        };
    }
  }

  /**
   * A name, email or keyword can live only inside an indexed document (for
   * example a child named in a certificate), so when the record fields match
   * nothing the same question is answered from the document chunks.
   */
  private async searchRecordsThenDocuments(
    message: string,
    filters: RecordSearchFilterDto,
    onDelta?: LlmDeltaHandler,
  ): Promise<AiChatResponseDto> {
    const result = await this.structuredRetrievalService.getFilteredRecords(filters, onDelta);

    const usedFilters = Object.keys(filters).filter((key) => key !== 'limit');
    const isTextOnly =
      usedFilters.length > 0 &&
      usedFilters.every((key) => TEXT_FILTER_KEYS.includes(key));

    return result.total === 0 && isTextOnly
      ? this.searchDocumentsAfterNoRecord(message, onDelta)
      : result;
  }

  /** Tells the user the records had no match before answering from the documents. */
  private async searchDocumentsAfterNoRecord(
    message: string,
    onDelta?: LlmDeltaHandler,
  ): Promise<AiChatResponseDto> {
    const notice =
      "I couldn't find a matching record, so I searched the uploaded documents instead.\n\n";
    onDelta?.(notice);

    const result = await this.recordRagService.searchRecords(message, onDelta);
    return { ...result, answer: notice + result.answer };
  }

  private async summarizeRecordThenSearchDocuments(
    message: string,
    recordIntent: AiChatIntentDto,
    onDelta?: LlmDeltaHandler,
  ): Promise<AiChatResponseDto> {
    const result = await this.structuredRetrievalService.getRecordSummary(
      recordIntent.recordId,
      recordIntent.filters,
      onDelta,
    );
    const askedAboutName = !recordIntent.recordId && recordIntent.filters?.name;

    return result.total === 0 && askedAboutName
      ? this.searchDocumentsAfterNoRecord(message, onDelta)
      : result;
  }

  private async getRecordIntent(message: string): Promise<AiChatIntentDto> {
    const content = await this.llmClient.chat({
      systemPrompt: RECORD_INTENT_PROMPT,
      userContent: message,
      temperature: 0,
      format: 'json',
      unavailableMessage: 'Recordly AI Assistant cannot reach the AI model right now.',
    });

    if (!content) {
      return { intent: AiChatIntent.UNSUPPORTED };
    }

    try {
      return this.normalizeIntent(JSON.parse(content));
    } catch {
      // Only the length is logged: the parse error text can echo the user's message.
      this.logger.warn(
        `Intent response was not valid JSON (length ${content.length}); treating as unsupported`,
      );
      return { intent: AiChatIntent.UNSUPPORTED };
    }
  }

  private normalizeIntent(value: unknown): AiChatIntentDto {
    if (!this.isObject(value)) {
      return { intent: AiChatIntent.UNSUPPORTED };
    }

    const requestedIntent = String(value.intent) as AiChatIntent;
    const intent = Object.values(AiChatIntent).includes(requestedIntent)
      ? requestedIntent
      : AiChatIntent.UNSUPPORTED;

    if (intent === AiChatIntent.UNSUPPORTED) {
      return { intent };
    }

    return {
      intent,
      filters: this.normalizeFilters(value.filters),
      recordId: this.normalizeRecordId(value.recordId),
    };
  }

  private normalizeFilters(value: unknown): RecordSearchFilterDto {
    if (!this.isObject(value)) {
      return {};
    }

    const filters = new RecordSearchFilterDto();

    if (
      value.status === RecordStatus.DRAFT ||
      value.status === RecordStatus.COMPLETED
    ) {
      filters.status = value.status;
    }

    for (const key of [
      'search',
      'name',
      'email',
      'mobileNumber',
      'city',
      'state',
      'country',
      'postalCode',
      'identityDocumentType',
      'financialAccountType',
      'financialAccountProvider',
    ] as const) {
      if (typeof value[key] === 'string' && value[key].trim()) {
        filters[key] = value[key].trim();
      }
    }

    if (
      typeof value.limit === 'number' &&
      Number.isFinite(value.limit) &&
      value.limit > 0
    ) {
      filters.limit = Math.floor(value.limit);
    }

    for (const key of [
      'isRedirected',
      'isAbroad',
      'hasDocuments',
      'hasFinancialAccounts',
    ] as const) {
      if (typeof value[key] === 'boolean') {
        filters[key] = value[key];
      }
    }

    return filters;
  }

  private normalizeRecordId(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
      return undefined;
    }

    return Math.floor(value);
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
