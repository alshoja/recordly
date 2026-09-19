import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatRequestDto } from '../dto/chat-request.dto';
import { LlmClient, LlmDeltaHandler } from '../llm/llm-client.interface';

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
}

const parseChatLine = (line: string) => JSON.parse(line) as OllamaChatResponse;

interface OllamaEmbeddingResponse {
  embeddings?: number[][];
}

@Injectable()
export class OllamaService implements LlmClient {
  constructor(private readonly configService: ConfigService) {}

  async chat(
    request: ChatRequestDto,
    onDelta?: LlmDeltaHandler,
  ): Promise<string> {
    this.ensureAiEnabled();

    try {
      const response = await fetch(
        `${this.configService.get<string>('config.ollamaBaseUrl')}/api/chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.configService.get<string>('config.ollamaModel'),
            stream: Boolean(onDelta),
            format: request.format,
            options: {
              temperature: request.temperature,
            },
            messages: [
              {
                role: 'system',
                content: request.systemPrompt,
              },
              {
                role: 'user',
                content: request.userContent,
              },
            ],
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Ollama responded with ${response.status}`);
      }

      if (onDelta) {
        return await this.readChatStream(response, onDelta);
      }

      const data = (await response.json()) as OllamaChatResponse;
      return data.message?.content?.trim() ?? '';
    } catch (error) {
      throw new ServiceUnavailableException(
        request.unavailableMessage ??
          'Recordly AI Assistant cannot reach Ollama right now.',
        { cause: error },
      );
    }
  }

  private async readChatStream(
    response: Response,
    onDelta: LlmDeltaHandler,
  ): Promise<string> {
    if (!response.body) {
      throw new Error('Ollama returned no stream');
    }

    const decoder = new TextDecoder();
    let pending = '';
    let content = '';

    const handleLine = (line: string) => {
      const text = parseChatLine(line).message?.content;
      if (text) {
        content += text;
        onDelta(text);
      }
    };

    for await (const chunk of response.body) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      lines.filter((line) => line.trim()).forEach(handleLine);
    }

    if (pending.trim()) {
      handleLine(pending);
    }

    return content.trim();
  }

  async embed(input: string): Promise<number[]> {
    this.ensureAiEnabled();

    try {
      const response = await fetch(
        `${this.configService.get<string>('config.ollamaBaseUrl')}/api/embed`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.configService.get<string>('config.ollamaEmbeddingModel'),
            input,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Ollama responded with ${response.status}`);
      }

      const data = (await response.json()) as OllamaEmbeddingResponse;
      const embedding = data.embeddings?.[0];
      if (!embedding?.length) {
        throw new Error('Ollama returned no embedding');
      }

      return embedding;
    } catch (error) {
      throw new ServiceUnavailableException(
        'Recordly AI Assistant cannot generate document embeddings right now.',
        { cause: error },
      );
    }
  }

  private ensureAiEnabled(): void {
    const aiChatEnabled = this.configService.get<boolean>('config.aiChatEnabled');

    if (!aiChatEnabled) {
      throw new ServiceUnavailableException('Recordly AI Assistant is turned off.');
    }
  }
}
