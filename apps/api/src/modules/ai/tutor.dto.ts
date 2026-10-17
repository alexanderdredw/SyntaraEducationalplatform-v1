import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { type AiContext, type AiMsgStatus, type AiQuickAction, type AiRole } from '@syntara/shared';

/** API-S-11: тело (схема — StudentConversationDto в packages/shared). */
export class ConversationBody {
  @ApiProperty({ enum: ['topic_tutor', 'general_tutor'] }) context: AiContext;
  @ApiPropertyOptional({ format: 'uuid', description: 'Обязателен для topic_tutor' }) topicId?: string;
}

/** API-S-11: ответ. */
export class ConversationCreatedDto {
  @ApiProperty({ format: 'uuid' }) id: string;
}

/** API-S-12: тело (схема — StudentMessageDto в packages/shared). */
export class MessageBody {
  @ApiProperty({ maxLength: 2000 }) content: string;
  @ApiPropertyOptional({ enum: ['simpler', 'more_detail', 'check_me'] }) quickAction?: AiQuickAction;
}

class ConversationTopicDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
}

class MessageDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['user', 'assistant'] }) role: AiRole;
  @ApiProperty() content: string;
  @ApiProperty({ enum: ['complete', 'partial', 'failed'], description: 'SM-AI-MESSAGE' }) status: AiMsgStatus;
  @ApiProperty({ type: String, enum: ['simpler', 'more_detail', 'check_me'], nullable: true })
  quickAction: AiQuickAction | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

/** API-S-13: история диалога. */
export class ConversationDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['topic_tutor', 'general_tutor'] }) context: AiContext;
  @ApiProperty({ type: ConversationTopicDto, nullable: true }) topic: ConversationTopicDto | null;
  @ApiProperty({ type: MessageDto, isArray: true }) messages: MessageDto[];
}
