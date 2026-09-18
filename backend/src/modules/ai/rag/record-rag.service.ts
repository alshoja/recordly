import { Inject, Injectable, Scope, ServiceUnavailableException } from '@nestjs/common';
import { RecordSearchResultDto } from '../../records/dto/search/record-search-result.dto';
import { AiChatCitationDto } from '../dto/ai-chat-citation.dto';
import { AiChatResponseDto } from '../dto/ai-chat-response.dto';
import { RagDocumentChunkDto } from '../dto/rag-document-chunk.dto';
import { RetrievedDocumentChunkDto } from '../dto/retrieved-document-chunk.dto';
import { AiChatIntent } from '../enums/ai-chat-intent.enum';
import { LLM_CLIENT, LlmClient, LlmDeltaHandler } from '../llm/llm-client.interface';
import { RAG_ANSWER_PROMPT } from '../prompts/rag.prompts';
import { DocumentHybridSearchService } from './document-hybrid-search.service';

@Injectable({ scope: Scope.REQUEST })
export class RecordRagService {
  constructor(
    @Inject(LLM_CLIENT) private readonly llmClient: LlmClient,
    private readonly documentHybridSearchService: DocumentHybridSearchService,
  ) {}

  async searchInRecord(
    question: string,
    recordId?: number,
    onDelta?: LlmDeltaHandler,
  ): Promise<AiChatResponseDto> {
    if (!recordId) {
      return {
        role: 'assistant',
        intent: AiChatIntent.DOCUMENT_QUESTION,
        answer: 'Please include the record ID whose documents you want to ask about.',
        records: [],
        total: 0,
      };
    }

    return this.answerFromDocumentChunks(
      question,
      AiChatIntent.DOCUMENT_QUESTION,
      recordId,
      onDelta,
    );
  }

  async searchRecords(
    question: string,
    onDelta?: LlmDeltaHandler,
  ): Promise<AiChatResponseDto> {
    return this.answerFromDocumentChunks(
      question,
      AiChatIntent.DOCUMENT_SEARCH,
      undefined,
      onDelta,
    );
  }

  private async answerFromDocumentChunks(
    question: string,
    intent: AiChatIntent.DOCUMENT_QUESTION | AiChatIntent.DOCUMENT_SEARCH,
    recordId?: number,
    onDelta?: LlmDeltaHandler,
  ): Promise<AiChatResponseDto> {
    const documentChunks = await this.findRecordDocumentChunks(question, recordId);
    if (documentChunks.length === 0) {
      return {
        role: 'assistant',
        intent,
        answer:
          "I couldn't find anything about that in the uploaded documents.",
        records: [],
        total: 0,
        citations: [],
      };
    }

    const answer = await this.llmClient.chat(
      {
        systemPrompt: RAG_ANSWER_PROMPT,
        userContent: JSON.stringify({
          question,
          documentChunks: documentChunks.map(({ documentName, pageNumber, content }, index) => ({
            source: index + 1,
            documentName,
            pageNumber,
            content,
          })),
        }),
        temperature: 0.1,
        unavailableMessage:
          'Recordly AI Assistant cannot answer document questions right now.',
      },
      onDelta,
    );

    if (!answer) {
      throw new ServiceUnavailableException(
        'Recordly AI Assistant cannot answer document questions right now.',
      );
    }

    // The answer is the source of truth: only the sources it cites (as [1], [2])
    // are shown as records and citations, so a "not found" answer shows neither.
    const citedChunks = documentChunks.filter((_, index) =>
      answer.includes(`[${index + 1}]`),
    );
    const records = this.getRecords(citedChunks);
    return {
      role: 'assistant',
      intent,
      answer: answer.replace(/\s*\[\d+\]/g, ''),
      records,
      total: records.length,
      citations: this.getCitations(citedChunks),
    };
  }

  private async findRecordDocumentChunks(
    question: string,
    recordId?: number,
  ): Promise<RetrievedDocumentChunkDto[]> {
    const embedding = await this.llmClient.embed(question);
    return this.documentHybridSearchService.findRecordDocumentChunks(
      question,
      embedding,
      recordId,
    );
  }

  private getCitations(
    documentChunks: RagDocumentChunkDto[],
  ): AiChatCitationDto[] {
    const citations = new Map<string, AiChatCitationDto>();
    for (const chunk of documentChunks) {
      citations.set(`${chunk.documentId}:${chunk.pageNumber ?? ''}`, {
        documentId: chunk.documentId,
        recordId: chunk.recordId,
        documentName: chunk.documentName,
        pageNumber: chunk.pageNumber,
      });
    }

    return [...citations.values()];
  }

  private getRecords(
    documentChunks: RetrievedDocumentChunkDto[],
  ): RecordSearchResultDto[] {
    const records = new Map<number, RecordSearchResultDto>();
    for (const chunk of documentChunks) {
      if (!records.has(chunk.recordId)) {
        records.set(chunk.recordId, {
          id: chunk.recordId,
          firstName: chunk.firstName,
          lastName: chunk.lastName,
          email: chunk.email,
          mobileNumber: chunk.mobileNumber,
          status: chunk.status,
          city: chunk.city,
          state: chunk.state,
          country: chunk.country,
        });
      }
    }

    return [...records.values()];
  }
}
