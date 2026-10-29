import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class AttemptOptionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() text: string;
}

class AttemptQuestionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['single_choice', 'true_false', 'text_input'] })
  type: 'single_choice' | 'true_false' | 'text_input';
  @ApiProperty({ enum: ['easy', 'medium', 'hard'] }) difficulty: 'easy' | 'medium' | 'hard';
  @ApiProperty() text: string;
  @ApiProperty({ type: AttemptOptionDto, isArray: true, description: 'Без признака правильности (BR-QZ-01)' })
  options: AttemptOptionDto[];
}

/** API-S-07: тело (необязательно) — попытка из задания (Q-18). */
export class AttemptStartBody {
  @ApiPropertyOptional({ format: 'uuid' }) assignmentId?: string;
}

/** API-S-08: результат ответа (BR-QZ-04). */
export class AnswerResultDto {
  @ApiProperty() correct: boolean;
  @ApiProperty({
    description: 'К вопросу взята подсказка «50/50» (REQ-TST-04): верный ответ весит для XP 0,5',
  })
  hinted: boolean;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) correctOptionId: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Правильный ответ для «Вписать ответ»' })
  correctAnswer: string | null;
  @ApiProperty({ type: String, nullable: true }) explanation: string | null;
}

class AnsweredDto extends AnswerResultDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) optionId: string | null;
  @ApiProperty({ type: String, nullable: true }) textAnswer: string | null;
}

/** API-S-07 */
export class AttemptDto {
  @ApiProperty({ format: 'uuid' }) attemptId: string;
  @ApiProperty({ type: AttemptQuestionDto, isArray: true }) questions: AttemptQuestionDto[];
  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/AnsweredDto' },
    description: 'Уже данные ответы незавершённой попытки (BR-QZ-06) по id вопроса',
  })
  answered: Record<string, AnsweredDto>;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string', format: 'uuid' } },
    description: 'REQ-TST-04: взятые подсказки «50/50» — убранные варианты по id вопроса',
  })
  hints: Record<string, string[]>;
  @ApiProperty({ description: 'Сколько подсказок «50/50» осталось в попытке (из 3)' }) hintsLeft: number;
}

export class HintBody {
  @ApiProperty({ format: 'uuid' }) questionId: string;
}

/** API-S-28: подсказка «50/50» (REQ-TST-04, BR-TST-01). */
export class HintResultDto {
  @ApiProperty({ format: 'uuid' }) questionId: string;
  @ApiProperty({ type: String, format: 'uuid', isArray: true, description: 'Два неверных варианта' })
  removedOptionIds: string[];
  @ApiProperty() hintsLeft: number;
}

export class AnswerBody {
  @ApiProperty({ format: 'uuid' }) questionId: string;
  @ApiPropertyOptional({ format: 'uuid' }) optionId?: string;
  @ApiPropertyOptional({ maxLength: 300 }) textAnswer?: string;
}

class AwardedBadgeDto {
  @ApiProperty() code: string;
  @ApiProperty() title: string;
}

/** API-S-09 */
export class FinishResultDto {
  @ApiProperty() scorePercent: number;
  @ApiProperty() xpAwarded: number;
  @ApiProperty({ type: AwardedBadgeDto, isArray: true }) badgesAwarded: AwardedBadgeDto[];
  @ApiProperty({ description: 'REQ-TST-05.2: лучший результат по теме с этой попыткой, %' })
  bestPercent: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'REQ-TST-05.2: результат прошлой завершённой попытки темы, %; null — это первая',
  })
  previousPercent: number | null;
}

/** Вопрос теста учителя (API-T-34): вместе с правильным ответом — проверка в браузере учителя, без записи. */
class TeacherTestQuestionDto extends AttemptQuestionDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) correctOptionId: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Правильный ответ для «Вписать ответ»' })
  correctAnswer: string | null;
  @ApiProperty({ type: String, nullable: true }) explanation: string | null;
}

/** API-T-34 */
export class TeacherTestDto {
  @ApiProperty({ type: TeacherTestQuestionDto, isArray: true }) questions: TeacherTestQuestionDto[];
}

export { AnsweredDto };
