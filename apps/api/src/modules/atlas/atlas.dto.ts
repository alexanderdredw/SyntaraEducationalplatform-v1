import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ATLAS_QUIZ_KINDS,
  type AtlasDifficulty,
  type AtlasQuizKind,
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

class AtlasQuizQuestionDto {
  @ApiProperty({ description: 'Номер вопроса с 1' }) index: number;
  @ApiProperty({ enum: ['easy', 'medium', 'hard'] }) difficulty: AtlasDifficulty;
  @ApiProperty() text: string;
  @ApiProperty({
    type: AtlasQuizOptionDto,
    isArray: true,
    description: 'Без признака правильного (BR-QZ-01)',
  })
  options: AtlasQuizOptionDto[];
}

class AtlasQuizMistakeDto {
  @ApiProperty({ description: 'Код элемента или учёного' }) code: string;
  @ApiProperty() title: string;
  @ApiProperty() description: string;
}

class AtlasQuizResultDto {
  @ApiProperty() correct: number;
  @ApiProperty() total: number;
  @ApiProperty({ description: 'Целые проценты' }) percent: number;
  @ApiProperty({ description: 'BR-XP-05: 1 XP за верный ответ, не больше дневного лимита' })
  xpAwarded: number;
  @ApiProperty({ type: AtlasQuizMistakeDto, isArray: true, description: '«Рекомендуется повторить»' })
  mistakes: AtlasQuizMistakeDto[];
}

/** API-S-24…27: состояние сессии квиза атласа. */
export class AtlasQuizSessionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ATLAS_QUIZ_KINDS }) kind: AtlasQuizKind;
  @ApiProperty({ enum: ['in_progress', 'finished'] }) status: 'in_progress' | 'finished';
  @ApiProperty() total: number;
  @ApiProperty({ description: 'Сколько вопросов уже отвечено' }) answered: number;
  @ApiProperty() correct: number;
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
  @ApiProperty() correctOptionId: string;
  @ApiProperty({
    type: AtlasQuizQuestionDto,
    nullable: true,
    description: 'Следующий вопрос; null — квиз пройден',
  })
  next: AtlasQuizQuestionDto | null;
}

export class AtlasQuizStartBody {
  @ApiProperty({ enum: ATLAS_QUIZ_KINDS }) kind: AtlasQuizKind;
}

export class AtlasQuizAnswerBody {
  @ApiProperty({ description: 'ID варианта из вопроса' }) optionId: string;
}

class PreviewQuestionDto {
  @ApiProperty() text: string;
  @ApiProperty({ type: String, isArray: true }) options: string[];
  @ApiProperty({ enum: ['easy', 'medium', 'hard'] }) difficulty: AtlasDifficulty;
}

/** API-T-31: предпросмотр вопросов для учителя — без правильных ответов (решение А-9). */
export class AtlasPreviewDto {
  @ApiProperty({ type: PreviewQuestionDto, isArray: true }) questions: PreviewQuestionDto[];
}
