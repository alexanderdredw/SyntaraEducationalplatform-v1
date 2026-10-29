import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ATLAS_QUIZ_KINDS, ATLAS_QUIZ_MODES, AtlasQuizStartDto, ELEMENT_FAMILIES } from '@syntara/shared';
import { type Dto } from '../../common/dto';
import { resolveLocale } from '../../common/locale';
import { UuidParamPipe } from '../../common/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Roles } from '../auth/auth.guards';
import { type AuthRequest } from '../auth/auth.types';
import { AtlasProgressService } from './atlas-progress.service';
import { AtlasQuizService } from './atlas-quiz.service';
import {
  AtlasDto,
  AtlasHintResultDto,
  AtlasPreviewDto,
  AtlasQuizAnswerBody,
  AtlasQuizAnswerResultDto,
  AtlasQuizSessionDto,
  AtlasQuizStartBody,
  AtlasScientistsProgressDto,
  SectionStudiedBody,
} from './atlas.dto';
import { AtlasService } from './atlas.service';

const locale = (req: AuthRequest) => resolveLocale(req.headers['accept-language']);

/**
 * Ученик: модуль «Mendeleev Atlas» (REQ-ATL-01…04, docs/CHEM_TZ_2.md). Невидимый предмет, предмет без модуля и чужая
 * сессия → 404 (BR-VIS-01, BR-ACL-03).
 */
@ApiTags('student')
@Controller('student')
@Roles('student')
export class StudentAtlasController {
  constructor(
    private readonly atlas: AtlasService,
    private readonly quiz: AtlasQuizService,
    private readonly progress: AtlasProgressService,
  ) {}

  /** API-S-31 (REQ-SCI-03, REQ-SCI-04): изученные учёные, лучшие результаты теста урока и игры. */
  @Get('subjects/:id/atlas/scientists-progress')
  @ApiOkResponse({ type: AtlasScientistsProgressDto })
  @ApiNotFoundResponse()
  scientistsProgress(
    @Param('id', new UuidParamPipe()) id: string,
    @Req() req: AuthRequest,
  ): Promise<AtlasScientistsProgressDto> {
    return this.progress.scientists(req.user!.id, id);
  }

  /** API-S-32 (BR-SCI-01): «Отметить как изученное» / снять отметку; неизвестный учёный → 404. */
  @Put('subjects/:id/atlas/scientists/:code/studied')
  @ApiBody({ type: SectionStudiedBody })
  @ApiOkResponse({ type: AtlasScientistsProgressDto })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  markScientist(
    @Param('id', new UuidParamPipe()) id: string,
    @Param('code') code: string,
    // Тело проверяется после предмета и учёного: неизвестный ID → 404, а не 400 (API-GEN-08).
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<AtlasScientistsProgressDto> {
    return this.progress.mark(req.user!.id, id, code, body);
  }

  /** API-S-23: данные экранов атласа со статусами тем ученика. */
  @Get('subjects/:id/atlas')
  @ApiOkResponse({ type: AtlasDto })
  @ApiNotFoundResponse()
  data(@Param('id', new UuidParamPipe()) id: string, @Req() req: AuthRequest): Promise<AtlasDto> {
    return this.atlas.data(req.user!.id, id, locale(req));
  }

  /** API-S-24: начать квиз «Проверь знания» (elements) или игру «Кто этот учёный?» (scientists). */
  @Post('subjects/:id/atlas-quiz')
  @HttpCode(201)
  @ApiBody({ type: AtlasQuizStartBody })
  @ApiOkResponse({ type: AtlasQuizSessionDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse({
    description:
      'quizEmpty: нет вопросов (или ошибок для «Повторить ошибки»); noMistakes: «Работа над ошибками» без ошибок',
  })
  start(
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(AtlasQuizStartDto)) dto: Dto<typeof AtlasQuizStartDto>,
    @Req() req: AuthRequest,
  ): Promise<AtlasQuizSessionDto> {
    return this.quiz.start(req.user!.id, id, dto.kind, locale(req), dto.retry, dto.mode, dto.family);
  }

  /** API-S-26: состояние своей сессии. */
  @Get('atlas-quiz/:sid')
  @ApiOkResponse({ type: AtlasQuizSessionDto })
  @ApiNotFoundResponse()
  get(@Param('sid', new UuidParamPipe()) sid: string, @Req() req: AuthRequest): Promise<AtlasQuizSessionDto> {
    return this.quiz.get(req.user!.id, sid, locale(req));
  }

  /** API-S-25: ответ на текущий вопрос. */
  @Post('atlas-quiz/:sid/answers')
  @HttpCode(200)
  @ApiBody({ type: AtlasQuizAnswerBody })
  @ApiOkResponse({ type: AtlasQuizAnswerResultDto })
  @ApiNotFoundResponse()
  @ApiBadRequestResponse({ description: 'Вариант не из текущего вопроса' })
  @ApiConflictResponse({ description: 'quizFinished: сессия завершена' })
  answer(
    @Param('sid', new UuidParamPipe()) sid: string,
    // Тело проверяется после проверки владельца сессии: чужая или неизвестная → 404 (API-GEN-08).
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<AtlasQuizAnswerResultDto> {
    return this.quiz.answer(req.user!.id, sid, body, locale(req));
  }

  /** API-S-29: подсказка «50/50» к текущему вопросу (REQ-TST-04, BR-TST-01). */
  @Post('atlas-quiz/:sid/hint')
  @HttpCode(200)
  @ApiOkResponse({ type: AtlasHintResultDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'quizFinished | hintLimit (3 взяты) | hintUnavailable' })
  hint(@Param('sid', new UuidParamPipe()) sid: string, @Req() req: AuthRequest): Promise<AtlasHintResultDto> {
    return this.quiz.hint(req.user!.id, sid);
  }

  /** API-S-27: завершить — XP (BR-XP-05) и день серии. */
  @Post('atlas-quiz/:sid/finish')
  @HttpCode(200)
  @ApiOkResponse({ type: AtlasQuizSessionDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'quizNotComplete | quizFinished' })
  finish(
    @Param('sid', new UuidParamPipe()) sid: string,
    @Req() req: AuthRequest,
  ): Promise<AtlasQuizSessionDto> {
    return this.quiz.finish(req.user!.id, sid, locale(req));
  }
}

/** Гость: данные экранов атласа базового предмета (BR-VIS-04); тест, квиз и ИИ — только после входа. */
@ApiTags('public')
@Controller('public')
export class PublicAtlasController {
  constructor(private readonly atlas: AtlasService) {}

  /** API-PUB-15: без статусов тем. */
  @Get('subjects/:id/atlas')
  @ApiOkResponse({ type: AtlasDto })
  @ApiNotFoundResponse()
  data(@Param('id', new UuidParamPipe()) id: string, @Req() req: AuthRequest): Promise<AtlasDto> {
    return this.atlas.data(null, id, locale(req));
  }
}

/** Учитель: вопросы квиза и игры атласа с правильными ответами — проходит как ученик, без записи (решение 2026-10-28). */
@ApiTags('teacher')
@Controller('teacher/atlas')
@Roles('teacher')
export class TeacherAtlasController {
  constructor(private readonly quiz: AtlasQuizService) {}

  /** API-T-32: вопросы квиза «Проверь знания» (elements) или игры про учёных (scientists). */
  @Get(':subjectId/preview')
  @ApiQuery({ name: 'kind', enum: ATLAS_QUIZ_KINDS })
  @ApiQuery({ name: 'mode', enum: ATLAS_QUIZ_MODES, required: false, description: 'REQ-TST-11' })
  @ApiQuery({ name: 'family', enum: ELEMENT_FAMILIES, required: false })
  @ApiOkResponse({ type: AtlasPreviewDto })
  @ApiNotFoundResponse()
  preview(
    @Param('subjectId', new UuidParamPipe()) subjectId: string,
    @Query(new ZodValidationPipe(AtlasQuizStartDto)) query: Dto<typeof AtlasQuizStartDto>,
    @Req() req: AuthRequest,
  ): Promise<AtlasPreviewDto> {
    return this.quiz.preview(subjectId, query.kind, locale(req), query.mode, query.family);
  }
}
