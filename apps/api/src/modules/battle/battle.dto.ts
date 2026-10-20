import { ApiProperty } from '@nestjs/swagger';

/** OpenAPI-описание тел и ответов Battle (SPEC 6.8). Схемы проверки — Zod в packages/shared (battle.ts). */

const LOCALES = ['ru', 'kk', 'en'];
const TYPES = ['single_choice', 'true_false'];

/** API-BTL-02 */
export class BattleQuizCreateBody {
  @ApiProperty({ maxLength: 120 }) title: string;
  @ApiProperty({ required: false, maxLength: 500 }) description?: string;
  @ApiProperty({ enum: LOCALES, description: 'Язык содержания теста; перевода нет' }) locale: string;
}

/** API-BTL-04 */
export class BattleQuizUpdateBody {
  @ApiProperty({ required: false, maxLength: 120 }) title?: string;
  @ApiProperty({ required: false, nullable: true, maxLength: 500, type: String }) description?: string | null;
  @ApiProperty({ required: false, enum: LOCALES }) locale?: string;
  @ApiProperty({ required: false, description: 'true — в архив, false — из архива' }) archived?: boolean;
}

class BattleOptionBody {
  @ApiProperty({ maxLength: 150, description: 'Для true_false текст задаёт сервер' }) text: string;
  @ApiProperty() isCorrect: boolean;
}

/** API-BTL-06 / API-BTL-07 (BattleQuestionDto, 6.8) */
export class BattleQuestionBody {
  @ApiProperty({ enum: TYPES }) type: string;
  @ApiProperty({ maxLength: 300 }) text: string;
  @ApiProperty({ required: false, nullable: true, format: 'uuid', type: String, description: 'Файл галереи' })
  imageMediaId?: string | null;
  @ApiProperty({ enum: [5, 10, 20, 30, 60, 90] }) timeLimitSec: number;
  @ApiProperty({
    type: BattleOptionBody,
    isArray: true,
    description: 'single_choice — 2–4, true_false — 2; ровно один isCorrect',
  })
  options: BattleOptionBody[];
}

/** API-BTL-09 */
export class BattleReorderBody {
  @ApiProperty({ type: String, isArray: true, format: 'uuid' }) questionIds: string[];
}

/** API-BTL-11 */
export class BattleImportBody {
  @ApiProperty({ format: 'uuid' }) topicId: string;
  @ApiProperty({ required: false, type: String, isArray: true, format: 'uuid' }) questionIds?: string[];
}

export class BattleIdDto {
  @ApiProperty({ format: 'uuid' }) id: string;
}

export class BattleImportedDto {
  @ApiProperty() imported: number;
}

/** API-BTL-01 */
export class BattleQuizListItemDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({ enum: LOCALES }) locale: 'ru' | 'kk' | 'en';
  @ApiProperty() questionsCount: number;
  @ApiProperty({ description: 'Число начатых игр' }) gamesCount: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastPlayedAt: string | null;
  @ApiProperty() archived: boolean;
}

export class BattleOptionDto {
  @ApiProperty({ minimum: 1, maximum: 4 }) position: number;
  @ApiProperty() text: string;
  @ApiProperty() isCorrect: boolean;
}

export class BattleQuestionItemDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ description: 'Порядковый номер в тесте' }) number: number;
  @ApiProperty({ enum: TYPES }) type: 'single_choice' | 'true_false';
  @ApiProperty() text: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) imageMediaId: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Подписанная ссылка (только clean, BR-FILE-04)' })
  imageUrl: string | null;
  @ApiProperty() timeLimitSec: number;
  @ApiProperty({ description: 'Импортирован из квиза темы (копия)' }) imported: boolean;
  @ApiProperty({ type: BattleOptionDto, isArray: true }) options: BattleOptionDto[];
}

/** API-BTL-03 */
export class BattleQuizDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ enum: LOCALES }) locale: 'ru' | 'kk' | 'en';
  @ApiProperty() archived: boolean;
  @ApiProperty() gamesCount: number;
  @ApiProperty({ type: BattleQuestionItemDto, isArray: true }) questions: BattleQuestionItemDto[];
}

class BattleImportQuestionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() text: string;
  @ApiProperty({ enum: TYPES }) type: 'single_choice' | 'true_false';
}

class BattleImportTopicDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({ description: 'Вопросы, которые можно скопировать (BR-BTL-10)' }) eligibleCount: number;
  @ApiProperty({
    type: BattleImportQuestionDto,
    isArray: true,
    description: 'Для выбора чекбоксами (BT-T02)',
  })
  questions: BattleImportQuestionDto[];
}

/** API-BTL-10 */
export class BattleImportSourceDto {
  @ApiProperty({ format: 'uuid' }) subjectId: string;
  @ApiProperty() subjectTitle: string;
  @ApiProperty() official: boolean;
  @ApiProperty({ type: BattleImportTopicDto, isArray: true }) topics: BattleImportTopicDto[];
}
