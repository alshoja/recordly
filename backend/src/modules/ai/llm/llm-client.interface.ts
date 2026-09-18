import { ChatRequestDto } from '../dto/chat-request.dto';

export const LLM_CLIENT = Symbol('LLM_CLIENT');

export type LlmDeltaHandler = (text: string) => void;

export interface LlmClient {
  /**
   * Returns the full reply. When `onDelta` is given, the reply is also streamed
   * to it in chunks as the model generates it.
   */
  chat(request: ChatRequestDto, onDelta?: LlmDeltaHandler): Promise<string>;
  embed(input: string): Promise<number[]>;
}
