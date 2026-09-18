import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ExtractedDocumentPage } from '../interfaces/extracted-document-page.interface';

export interface PreparedDocumentChunk {
  chunkIndex: number;
  pageNumber: number;
  content: string;
}

@Injectable()
export class DocumentChunkingService {
  prepareDocumentChunks(
    pages: ExtractedDocumentPage[],
  ): PreparedDocumentChunk[] {
    let chunkIndex = 0;
    const chunks: PreparedDocumentChunk[] = [];

    for (const page of pages) {
      const redactedText = this.removeSensitiveInformation(page.text);
      for (const content of this.splitTextIntoOverlappingChunks(redactedText)) {
        chunks.push({
          chunkIndex,
          pageNumber: page.pageNumber,
          content,
        });
        chunkIndex += 1;
      }
    }

    return chunks;
  }

  createDocumentChunksHash(chunks: PreparedDocumentChunk[]): string {
    return createHash('sha256')
      .update(chunks.map((chunk) => chunk.content).join('\n'))
      .digest('hex');
  }

  private removeSensitiveInformation(text: string): string {
    return text
      // PostgreSQL text columns reject NUL bytes, which some PDF extractions contain.
      .replace(/\x00/g, '')
      .replace(/\b[A-Z]{3}\s?\d{7}\b/gi, '[REDACTED ID]')
      .replace(/\b[A-Z]{2}\s?\d{2}\s?\d{4}\s?\d{7}\b/gi, '[REDACTED ID]')
      .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[REDACTED ID]')
      .replace(/\b[A-Z]\d{7}\b/gi, '[REDACTED ID]')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED EMAIL]')
      .replace(/(?:\+?\d[\d\s()-]{8,}\d)/g, '[REDACTED PHONE]')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private splitTextIntoOverlappingChunks(text: string): string[] {
    const chunks: string[] = [];
    const chunkSize = 1200;
    const overlap = 200;

    for (let start = 0; start < text.length; start += chunkSize - overlap) {
      const chunk = text.slice(start, start + chunkSize).trim();
      if (chunk) {
        chunks.push(chunk);
      }
    }

    return chunks;
  }
}
