import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ATLAS_QUESTION_TYPES,
  ATLAS_QUIZ_KINDS,
  ATLAS_QUIZ_MODES,
  type AtlasAnswerKind,
  type AtlasDifficulty,
  type AtlasQuestionType,
  type AtlasQuizKind,
  type AtlasQuizMode,
  ELEMENT_FAMILIES,
} from '@syntara/shared';

/** OpenAPI-описание модуля «Mendeleev Atlas» (REQ-ATL-01…05, docs/CHEM_TZ_2.md). Валидация — Zod (packages/shared). */

class AtlasSubjectDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
}

/** Карточка Explore и окно элемента (REQ-ATL-03): тема-элемент предмета. */
class AtlasElementDto {
  @ApiProperty({ format: 'uuid' }) topicId: string;
  @ApiProperty({ description: 'Код темы без кода предмета: oxygen' }) code: string;
  @ApiProperty({ minimum: 1, maximum: 118 }) number: number;
  @ApiProperty() symbol: string;
  @ApiProperty({ enum: ELEMENT_FAMILIES }) group: string;
  @ApiProperty({ description: 'Цвет элемента атласа #RRGGBB (REQ-ATL-04)', type: String, nullable: true })
  color: string | null;
  @ApiProperty() title: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ type: String, nullable: true }) funFact: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Подписанная ссылка на 10 минут (BR-FILE-04)' })
  imageUrl: string | null;
  @ApiProperty({ type: String, nullable: true }) imageAlt: string | null;
  @ApiPropertyOptional({
    enum: ['mastered', 'started', 'not_started'],
    description: 'Статус темы — только у ученика (решение А-6)',
  })
  status?: 'mastered' | 'started' | 'not_started';
}

class AtlasTopicRefDto {
  @ApiProperty({ format: 'uuid' }) topicId: string;
  @ApiProperty() title: string;
  @ApiPropertyOptional({ enum: ['mastered', 'started', 'not_started'] })
  status?: 'mastered' | 'started' | 'not_started';
}

/** Панель показателей экрана Syntara AI (решение А-15): только у ученика, по квизам тем предмета. */
class AtlasStatsDto {
  @ApiProperty({ description: 'Темы с попыткой квиза, лучший результат ниже порога освоения (PH-38)' })
  weak: number;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Рекомендуется: слабейшая начатая тема, иначе первая не начатая; всё освоено — null',
  })
  recommended: string | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Доля верных ответов в квизах тем предмета, %; нет ответов — null',
  })
  accuracy: number | null;
}

/** API-S-23, API-PUB-15: данные экранов атласа. */
export class AtlasDto {
  @ApiProperty({ type: AtlasSubjectDto }) subject: AtlasSubjectDto;
  @ApiProperty({ type: AtlasElementDto, isArray: true, description: 'По атомному номеру' })
  elements: AtlasElementDto[];
  @ApiProperty({
    type: AtlasTopicRefDto,
    nullable: true,
    description: 'Урок «Учёные-химики» (экран «Учёные»)',
  })
  scientists: AtlasTopicRefDto | null;
  @ApiProperty() hasGlossary: boolean;
  @ApiProperty({ description: 'Показанный перевод ждёт вычитки (BR-CNT-05)' }) needsReview: boolean;
  @ApiPropertyOptional({ type: AtlasStatsDto, description: 'Только у ученика' }) stats?: AtlasStatsDto;
}

class AtlasQuizOptionDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
}

export class AtlasQuizQuestionDto {
  @ApiProperty({ description: 'Номер вопроса с 1' }) index: number;
  @ApiProperty({
    enum: ATLAS_QUESTION_TYPES,
    nullable: true,
    description: 'REQ-TST-10: тип вопроса квиза элементов; null — игра про учёных и сессии до T2',
  })
  type: AtlasQuestionType | null;
  @ApiProperty({
    enum: ['choice', 'boolean', 'input', 'table'],
    description: 'Как отвечать: выбор варианта, «Верно/Неверно», ввод символа, клик по ячейке таблицы',
  })
  answerKind: AtlasAnswerKind;
  @ApiProperty({ enum: ['easy', 'medium', 'hard'] }) difficulty: AtlasDifficulty;
  @ApiProperty({ type: String, nullable: true, description: 'Заголовок над текстом («Какой это элемент?»)' })
  intro: string | null;
  @ApiProperty() text: string;
  @ApiProperty({
    type: AtlasQuizOptionDto,
    isArray: true,
    description: 'Без признака правильного (BR-QZ-01)',
  })
  options: AtlasQuizOptionDto[];
  @ApiProperty({
    type: String,
    isArray: true,
    description: 'REQ-TST-04: варианты, убранные подсказкой «50/50» (пусто — подсказки нет)',
  })
  removed: string[];
  @ApiProperty({
    type: Number,
    isArray: true,
    nullable: true,
    description: 'REQ-TST-10.2: схема Бора — электроны по оболочкам (без символа); null — не схема',
  })
  shells: number[] | null;
  @ApiProperty({
    type: Number,
    isArray: true,
    description: 'REQ-TST-10.3: «50/50» у таблицы — подсвеченные периоды (пусто — подсказки нет)',
  })
  rows: number[];
}

/**
 * Правильный ответ (REQ-TST-01, REQ-TST-09.3): ссылка «Открыть урок» и объяснение «Это {название} ({символ}, № {N},
 * {семейство}). {описание}» — текст собирает клиент из i18n; у учёного символа, номера и семейства нет.
 */
export class AtlasAnswerInfoDto {
  @ApiProperty({ description: 'Код элемента или учёного' }) code: string;
  @ApiProperty() title: string;
  @ApiProperty() description: string;
  @ApiProperty({ type: String, nullable: true }) symbol: string | null;
  @ApiProperty({ type: Number, nullable: true }) number: number | null;
  @ApiProperty({ type: String, nullable: true, enum: ELEMENT_FAMILIES }) family: string | null;
}

class AtlasQuizMistakeDto extends AtlasAnswerInfoDto {
  @ApiProperty({ description: 'Текст вопроса, как он был показан' }) question: string;
  @ApiProperty({ description: 'Выбранный ответ' }) selected: string;
}

class AtlasFamilyScoreDto {
  @ApiProperty({ enum: ELEMENT_FAMILIES }) family: string;
  @ApiProperty() correct: number;
  @ApiProperty() total: number;
}

class AtlasAnswerMarkDto {
  @ApiProperty() correct: boolean;
  @ApiProperty() hinted: boolean;
}

class AtlasQuizResultDto {
  @ApiProperty() correct: number;
  @ApiProperty() total: number;
  @ApiProperty({ description: 'Целые проценты' }) percent: number;
  @ApiProperty({ description: 'REQ-TST-05.1: сколько верных — с подсказкой «50/50»' }) hinted: number;
  @ApiProperty({
    description: 'BR-XP-05: 1 XP за верный ответ (с подсказкой — 0,5), не больше дневного лимита',
  })
  xpAwarded: number;
  @ApiProperty({ description: 'REQ-TST-05.2: лучший результат этого вида квиза, %' }) bestPercent: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'REQ-TST-05.2: прошлая сессия, %; null — первая',
  })
  previousPercent: number | null;
  @ApiProperty({
    type: AtlasFamilyScoreDto,
    isArray: true,
    description: 'REQ-TST-05.5: верно/всего по семействам (только квиз элементов)',
  })
  families: AtlasFamilyScoreDto[];
  @ApiProperty({ type: AtlasQuizMistakeDto, isArray: true, description: 'Ошибки (REQ-TST-05.3)' })
  mistakes: AtlasQuizMistakeDto[];
}

/** API-S-24…27: состояние сессии квиза атласа. */
export class AtlasQuizSessionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ATLAS_QUIZ_KINDS }) kind: AtlasQuizKind;
  @ApiProperty({ enum: ATLAS_QUIZ_MODES, description: 'REQ-TST-11: режим квиза' }) mode: AtlasQuizMode;
  @ApiProperty({
    type: String,
    nullable: true,
    enum: ELEMENT_FAMILIES,
    description: 'REQ-TST-11 «По семейству»: семейство (для «Пройти ещё раз»)',
  })
  family: string | null;
  @ApiProperty({ enum: ['in_progress', 'finished'] }) status: 'in_progress' | 'finished';
  @ApiProperty() total: number;
  @ApiProperty({ description: 'Сколько вопросов уже отвечено' }) answered: number;
  @ApiProperty() correct: number;
  @ApiProperty({ type: AtlasAnswerMarkDto, isArray: true, description: 'REQ-TST-02: полоса прогресса' })
  answers: AtlasAnswerMarkDto[];
  @ApiProperty({ description: 'REQ-TST-04: сколько подсказок «50/50» осталось (из 3)' }) hintsLeft: number;
  @ApiProperty({
    type: AtlasQuizQuestionDto,
    nullable: true,
    description: 'Текущий вопрос; null — все отвечены',
  })
  question: AtlasQuizQuestionDto | null;
  @ApiProperty({ type: AtlasQuizResultDto, nullable: true, description: 'Только у завершённой сессии' })
  result: AtlasQuizResultDto | null;
}

/** API-S-25: проверка ответа сразу (как BR-QZ-04). */
export class AtlasQuizAnswerResultDto {
  @ApiProperty() correct: boolean;
  @ApiProperty({ description: 'REQ-TST-04: ответ дан с подсказкой «50/50»' }) hinted: boolean;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Правильный вариант (у таблицы — ID элемента); null — ответ вводом',
  })
  correctOptionId: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Правильный ответ словами — у ввода символа и таблицы (REQ-TST-10)',
  })
  correctAnswer: string | null;
  @ApiProperty({
    description:
      'REQ-TST-10 «Впишите символ»: верные буквы, но не тот регистр («ca») — «Обратите внимание на заглавную букву»',
  })
  caseHint: boolean;
  @ApiProperty({ type: AtlasAnswerInfoDto, nullable: true }) answer: AtlasAnswerInfoDto | null;
  @ApiProperty({
    type: AtlasQuizQuestionDto,
    nullable: true,
    description: 'Следующий вопрос; null — квиз пройден',
  })
  next: AtlasQuizQuestionDto | null;
}

/** API-S-29: подсказка «50/50» (REQ-TST-04, BR-TST-01). */
export class AtlasHintResultDto {
  @ApiProperty({ type: String, isArray: true, description: 'Два неверных варианта (у таблицы — пусто)' })
  removedOptionIds: string[];
  @ApiProperty({
    type: Number,
    isArray: true,
    description: 'REQ-TST-10.3: у таблицы — два подсвеченных периода (у выбора — пусто)',
  })
  rows: number[];
  @ApiProperty() hintsLeft: number;
}

export class AtlasQuizStartBody {
  @ApiProperty({ enum: ATLAS_QUIZ_KINDS }) kind: AtlasQuizKind;
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'REQ-TST-05.4 «Повторить ошибки»: своя завершённая сессия — вопросы только по её ошибкам',
  })
  retry?: string;
  @ApiPropertyOptional({
    enum: ATLAS_QUIZ_MODES,
    description: 'REQ-TST-11: режим квиза элементов (по умолчанию quick)',
  })
  mode?: AtlasQuizMode;
  @ApiPropertyOptional({
    enum: ELEMENT_FAMILIES,
    description: 'REQ-TST-11 «По семейству»: семейство (≥ 4 элементов с уроками)',
  })
  family?: string;
}

export class AtlasQuizAnswerBody {
  @ApiPropertyOptional({ description: 'ID варианта, «true»/«false» или ID элемента ячейки таблицы' })
  optionId?: string;
  @ApiPropertyOptional({ description: 'REQ-TST-10 «Впишите символ»: введённый символ' }) text?: string;
}

class PreviewQuestionDto extends AtlasQuizQuestionDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Правильный вариант (у таблицы — ID элемента) — проверка в браузере учителя; null — ввод',
  })
  correctOptionId: string | null;
  @ApiProperty({ type: String, nullable: true, description: '«Впишите символ»: правильный символ' })
  correctText: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Правильный ответ словами (ввод, таблица)' })
  correctAnswer: string | null;
  @ApiProperty({ type: Number, isArray: true, description: '«50/50» у таблицы — периоды для подсветки' })
  hintRows: number[];
  @ApiProperty({ type: AtlasAnswerInfoDto, description: 'Правильный ответ — объяснение и «Открыть урок»' })
  answer: AtlasAnswerInfoDto;
}

/**
 * API-T-32 (решение владельца 2026-10-28): вопросы квиза или игры для учителя вместе с правильным ответом — учитель
 * проходит тест так же, как ученик, но ничего не записывается.
 */
export class AtlasPreviewDto {
  @ApiProperty({ type: PreviewQuestionDto, isArray: true }) questions: PreviewQuestionDto[];
}
