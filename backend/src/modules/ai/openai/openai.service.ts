import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { EMBEDDING_DIMENSIONS } from '../../../shared/utilities/vector.utility';
import { ChatRequestDto } from '../dto/chat-request.dto';
import { LlmClient, LlmDeltaHandler } from '../llm/llm-client.interface';

@Injectable()
export class OpenAiService implements LlmClient {
  private readonly client: OpenAI;

  constructor(private readonly configService: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.configService.get<string>('config.openaiApiKey'),
    });
  }

  async chat(
    request: ChatRequestDto,
    onDelta?: LlmDeltaHandler,
  ): Promise<string> {
    this.ensureAiEnabled();

    const completionRequest = {
      model: this.configService.get<string>('config.openaiModel')!,
      temperature: request.temperature,
      response_format:
        request.format === 'json' ? { type: 'json_object' as const } : undefined,
      messages: [
        { role: 'system' as const, content: request.systemPrompt },
        { role: 'user' as const, content: request.userContent },
      ],
    };

    try {
      if (onDelta) {
        return await this.readChatStream(completionRequest, onDelta);
      }

      const response = await this.client.chat.completions.create(completionRequest);
      return response.choices[0]?.message?.content?.trim() ?? '';
    } catch {
      throw new ServiceUnavailableException(
        request.unavailableMessage ??
          'Recordly AI Assistant cannot reach OpenAI right now.',
      );
    }
  }

  private async readChatStream(
    completionRequest: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    onDelta: LlmDeltaHandler,
  ): Promise<string> {
    const stream = await this.client.chat.completions.create({
      ...completionRequest,
      stream: true,
    });
    let content = '';

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) {
        content += text;
        onDelta(text);
      }
    }

    return content.trim();
  }

  async embed(input: string): Promise<number[]> {
    this.ensureAiEnabled();

    try {
      const response = await this.client.embeddings.create({
        model: this.configService.get<string>('config.openaiEmbeddingModel')!,
        input,
        dimensions: EMBEDDING_DIMENSIONS,
      });

      const embedding = response.data[0]?.embedding;
      if (!embedding?.length) {
        throw new Error('OpenAI returned no embedding');
      }

      return embedding;
    } catch {
      throw new ServiceUnavailableException(
        'Recordly AI Assistant cannot generate document embeddings right now.',
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
