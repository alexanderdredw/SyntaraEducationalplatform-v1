import { ApiProperty } from '@nestjs/swagger';

type Tr<T> = Partial<Record<'ru' | 'kk' | 'en', T>>;

/** API-T-20 / API-T-21 PUT (QuestionDto, 6.7). */
export class QuestionBody {
  @ApiProperty({ enum: ['single_choice', 'true_false', 'text_input'] }) type: string;
  @ApiProperty({ enum: ['easy', 'medium', 'hard'] }) difficulty: string;
  @ApiProperty({
    type: 'object',
    description: 'По языкам: { text ≤ 1000, explanation? ≤ 2000 }; хотя бы один язык',
    additionalProperties: true,
  })
  translations: Tr<{ text: string; explanation?: string }>;
  @ApiProperty({
    required: false,
    description: '2–8 вариантов, ровно один isCorrect; для true_false тексты задаёт сервер',
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  options?: Array<{ translations: Tr<string>; isCorrect: boolean }>;
  @ApiProperty({ required: false, maxLength: 300 }) textAnswer?: string;
}

class OptionItemDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() isCorrect: boolean;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) translations: Tr<string>;
}

/** Вопрос для автора (правильный ответ виден только владельцу). */
export class QuestionItemDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ description: 'Порядковый номер в квизе' }) number: number;
  @ApiProperty({ enum: ['single_choice', 'true_false', 'text_input'] })
  type: 'single_choice' | 'true_false' | 'text_input';
  @ApiProperty({ enum: ['easy', 'medium', 'hard'] }) difficulty: 'easy' | 'medium' | 'hard';
  @ApiProperty({ type: String, nullable: true }) textAnswer: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true })
  translations: Tr<{ text: string; explanation: string | null }>;
  @ApiProperty({ type: OptionItemDto, isArray: true }) options: OptionItemDto[];
}

/** API-T-19 */
export class QuizDto {
  @ApiProperty({ format: 'uuid' }) quizId: string;
  @ApiProperty({ type: QuestionItemDto, isArray: true }) questions: QuestionItemDto[];
}

export class QuestionIdDto {
  @ApiProperty({ format: 'uuid' }) id: string;
}
