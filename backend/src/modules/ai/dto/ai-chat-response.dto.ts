import { RecordSearchResultDto } from '../../records/dto/search/record-search-result.dto';
import { AiChatIntent } from '../enums/ai-chat-intent.enum';
import { AiChatCitationDto } from './ai-chat-citation.dto';

export class AiChatResponseDto {
  role: 'assistant';
  intent: AiChatIntent;
  answer: string;
  records: RecordSearchResultDto[];
  total: number;
  recordId?: number;
  citations?: AiChatCitationDto[];
}
