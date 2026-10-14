import { ApiProperty } from '@nestjs/swagger';

class ChatMessageBody {
  @ApiProperty({ enum: ['user', 'assistant'] }) role: 'user' | 'assistant';
  @ApiProperty() content: string;
}

/** API-PUB-06: тело запроса (схема — PublicAssistantDto в packages/shared). */
export class PublicAssistantBody {
  @ApiProperty({ maxLength: 2000 }) message: string;
  @ApiProperty({ type: ChatMessageBody, isArray: true, maxItems: 20, required: false })
  history?: ChatMessageBody[];
}
