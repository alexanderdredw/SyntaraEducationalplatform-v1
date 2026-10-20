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

/* ---- Сессии и участие (API-BTL-20…46) ---- */

class BattleSettingsBody {
  @ApiProperty({ default: false }) shuffleQuestions: boolean;
  @ApiProperty({ default: false }) shuffleOptions: boolean;
  @ApiProperty({ default: true, description: 'Промежуточный рейтинг (топ-5)' }) leaderboard: boolean;
  @ApiProperty({ default: false, description: 'Автопереход через 5 с' }) autoAdvance: boolean;
  @ApiProperty({ default: false, description: 'Позднее подключение' }) lateJoin: boolean;
  @ApiProperty({ default: 100, minimum: 1, maximum: 100 }) maxParticipants: number;
}

/** API-BTL-20: класс не выбирается (BR-BTL-02, Q-BTL-01). */
export class BattleSessionCreateBody {
  @ApiProperty({ type: BattleSettingsBody, required: false }) settings?: BattleSettingsBody;
}

export class BattleSessionCreatedDto {
  @ApiProperty({ format: 'uuid' }) sessionId: string;
  @ApiProperty({ pattern: '^[A-Z]{3}[1-9]{3}$', example: 'KTR583' }) code: string;
}

/** API-BTL-23…27 */
export class BattleTransitionBody {
  @ApiProperty({ minimum: 0, description: 'state_version снимка (BR-BTL-08)' }) expectedVersion: number;
}

/** Снимок API-BTL-21 / API-BTL-41 — типы BattleHostSnapshot / BattleStudentSnapshot (packages/shared). */
export class BattleSnapshotDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['lobby', 'in_progress', 'finished', 'cancelled'] }) status: string;
  @ApiProperty({ enum: ['lobby', 'question', 'reveal', 'leaderboard', 'finished'] }) phase: string;
  @ApiProperty() version: number;
  @ApiProperty({ type: String, format: 'date-time' }) serverNow: string;
}

/** Итоги API-BTL-30 / API-BTL-46 — тип BattleResults (packages/shared). */
export class BattleResultsDto {
  @ApiProperty({ type: 'object', additionalProperties: true }) session: Record<string, unknown>;
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) podium: unknown[];
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) table: unknown[];
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) questions: unknown[];
  @ApiProperty({ type: 'array', items: { type: 'integer' } }) hardQuestions: number[];
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) students: unknown[];
}

class BattleHistoryItemDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() battleTitle: string;
  @ApiProperty({ type: String, nullable: true, description: 'Класс прошедшей сессии (до Q-BTL-01)' })
  className: string | null;
  @ApiProperty({ enum: ['lobby', 'in_progress', 'finished', 'cancelled'] }) status: string;
  @ApiProperty() participantsCount: number;
  @ApiProperty() questionsCount: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) startedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) finishedAt: string | null;
}

/** API-BTL-29 */
export class BattleHistoryDto {
  @ApiProperty({ type: BattleHistoryItemDto, isArray: true }) items: BattleHistoryItemDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

class BattleStudentHistoryItemDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() battleTitle: string;
  @ApiProperty() teacherName: string;
  @ApiProperty({ type: String, format: 'date-time' }) finishedAt: string;
  @ApiProperty({ type: Number, nullable: true }) rank: number | null;
  @ApiProperty() participantsCount: number;
  @ApiProperty({ type: Number, nullable: true }) correctCount: number | null;
  @ApiProperty() questionsCount: number;
}

/** API-BTL-45 */
export class BattleStudentHistoryDto {
  @ApiProperty({ type: BattleStudentHistoryItemDto, isArray: true }) items: BattleStudentHistoryItemDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

/** API-BTL-40 */
export class BattleJoinBody {
  @ApiProperty({ example: 'ktr 583', description: 'Регистр и пробелы не важны (BR-BTL-01)' }) code: string;
}

export class BattleJoinedDto {
  @ApiProperty({ format: 'uuid' }) sessionId: string;
}

/** API-BTL-43 */
export class BattleAnswerBody {
  @ApiProperty({ minimum: 0 }) questionIndex: number;
  @ApiProperty({ minimum: 1, maximum: 4 }) optionPosition: number;
  @ApiProperty({ format: 'uuid', description: 'Идемпотентность повтора (BR-BTL-03)' }) clientAnswerId: string;
}

export class BattleAcceptedDto {
  @ApiProperty({ enum: [true] }) accepted: true;
}
