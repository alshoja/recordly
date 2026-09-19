import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Logger,
  MessageEvent,
  Post,
  RequestMethod,
  Sse,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { AiChatMessageDto } from '../dto/ai-chat-message.dto';
import { AiChatService } from './ai-chat.service';

@Controller('ai-chat')
export class AiChatController {
  private readonly logger = new Logger(AiChatController.name);

  constructor(private readonly aiChatService: AiChatService) {}

  @Post('message')
  ask(@Body() aiChatMessageDto: AiChatMessageDto) {
    return this.aiChatService.ask(aiChatMessageDto.message);
  }

  /**
   * Server-Sent Events variant of `message`. Emits `delta` events with answer
   * text as the model generates it, then `done` with the full response, or
   * `error`. Answers that need no model text send only `done`.
   */
  @Sse('message/stream', { method: RequestMethod.POST })
  @HttpCode(200)
  askStream(@Body() aiChatMessageDto: AiChatMessageDto): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      this.aiChatService
        .ask(aiChatMessageDto.message, (text) =>
          subscriber.next({ type: 'delta', data: { text } }),
        )
        .then((response) => subscriber.next({ type: 'done', data: response }))
        .catch((error: unknown) => {
          this.logStreamError(error);
          subscriber.next({
            type: 'error',
            data: {
              message:
                error instanceof Error
                  ? error.message
                  : 'Recordly AI Assistant could not answer right now.',
            },
          });
        })
        .finally(() => subscriber.complete());
    });
  }

  /**
   * A stream error is sent to the client as an event, so it never reaches the
   * global exception filter and has to be logged here.
   */
  private logStreamError(error: unknown): void {
    const origin =
      error instanceof HttpException && error.cause ? error.cause : error;

    this.logger.error(
      `POST /ai-chat/message/stream failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      origin instanceof Error ? origin.stack : undefined,
    );
  }
}
