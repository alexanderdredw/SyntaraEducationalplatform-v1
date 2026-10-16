import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { type Response } from 'express';
import {
  AiDraftDto,
  GrantAccessDto,
  LessonEventDto,
  PublishDto,
  SubjectDto,
  TopicContentDto,
} from '@syntara/shared';
import { type Dto } from '../../common/dto';
import { resolveLocale } from '../../common/locale';
import { UuidParamPipe } from '../../common/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Roles } from '../auth/auth.guards';
import { type AuthRequest } from '../auth/auth.types';
import { AiDraftService } from './ai-draft.service';
import {
  AiDraftBody,
  AiDraftResponse,
  CatalogDto,
  CreatedIdDto,
  GrantAccessBody,
  LessonDto,
  LessonEventBody,
  PublishBody,
  SectionDto,
  StudentSubjectDto,
  PublishResultDto,
  SubjectBody,
  SubjectDetailDto,
  SubjectSummaryDto,
  TopicBody,
  TopicDetailDto,
  TopicVersionDto,
} from './content.dto';
import { Owns } from './ownership.guard';
import { StudentContentService } from './student-content.service';
import { SubjectsService } from './subjects.service';
import { TopicsService } from './topics.service';

const locale = (req: AuthRequest) => resolveLocale(req.headers['accept-language']);

/** Предметы учителя (6.4, 8.3.1–8.3.2). Чужой или несуществующий предмет → 404 (BR-ACL-01). */
@ApiTags('teacher')
@Controller('teacher/subjects')
@Roles('teacher')
export class TeacherSubjectsController {
  constructor(private readonly subjects: SubjectsService) {}

  /** API-T-01 */
  @Get()
  @ApiOkResponse({ type: SubjectSummaryDto, isArray: true })
  list(@Req() req: AuthRequest): Promise<SubjectSummaryDto[]> {
    return this.subjects.list(req.user!.id, locale(req));
  }

  /** API-T-02 */
  @Post()
  @HttpCode(201)
  @ApiBody({ type: SubjectBody })
  @ApiCreatedResponse({ type: CreatedIdDto })
  @ApiBadRequestResponse({ description: 'Ни в одном языке нет названия; длины PH-23' })
  create(
    @Body(new ZodValidationPipe(SubjectDto)) dto: Dto<typeof SubjectDto>,
    @Req() req: AuthRequest,
  ): Promise<CreatedIdDto> {
    return this.subjects.create(req.user!.id, dto);
  }

  /** API-T-03 */
  @Get(':id')
  @Owns('subject')
  @ApiOkResponse({ type: SubjectDetailDto })
  get(@Param('id', new UuidParamPipe()) id: string, @Req() req: AuthRequest): Promise<SubjectDetailDto> {
    return this.subjects.get(req.user!.id, id, locale(req));
  }

  /** API-T-03 */
  @Patch(':id')
  @Owns('subject')
  @HttpCode(204)
  @ApiBody({ type: SubjectBody })
  @ApiNoContentResponse()
  @ApiBadRequestResponse()
  update(
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(SubjectDto)) dto: Dto<typeof SubjectDto>,
    @Req() req: AuthRequest,
  ): Promise<void> {
    return this.subjects.update(req.user!.id, id, dto);
  }

  /** API-T-07: первая выдача — 201, повтор — 200 без дубля. */
  @Post(':id/access')
  @Owns('subject')
  @ApiBody({ type: GrantAccessBody })
  @ApiCreatedResponse({ description: 'Предмет выдан классу' })
  @ApiOkResponse({ description: 'Уже выдан — без изменений' })
  @ApiNotFoundResponse({ description: 'Чужой предмет или чужой класс' })
  async grant(
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(GrantAccessDto)) dto: Dto<typeof GrantAccessDto>,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const { created } = await this.subjects.grant(req.user!.id, id, dto.classId);
    res.status(created ? 201 : 200);
  }

  /** API-T-08 */
  @Delete(':id/access/:classId')
  @Owns('subject')
  @HttpCode(204)
  @ApiNoContentResponse()
  revoke(
    @Param('id', new UuidParamPipe()) id: string,
    @Param('classId', new UuidParamPipe()) classId: string,
    @Req() req: AuthRequest,
  ): Promise<void> {
    return this.subjects.revoke(req.user!.id, id, classId);
  }

  /** API-T-09: черновик темы → редактор (REQ-TCH-ACC-02). */
  @Post(':id/topics')
  @Owns('subject')
  @HttpCode(201)
  @ApiCreatedResponse({ type: CreatedIdDto })
  createTopic(@Param('id', new UuidParamPipe()) id: string): Promise<CreatedIdDto> {
    return this.subjects.createTopic(id);
  }
}

/** Темы учителя (6.4, 8.3.3–8.3.4, SM-TOPIC). Чужая или несуществующая тема → 404 (BR-ACL-01). */
@ApiTags('teacher')
@Controller('teacher/topics')
@Roles('teacher')
export class TeacherTopicsController {
  constructor(
    private readonly topics: TopicsService,
    private readonly aiDraft: AiDraftService,
  ) {}

  /** API-T-10 */
  @Get(':id')
  @Owns('topic')
  @ApiOkResponse({ type: TopicDetailDto })
  get(@Param('id', new UuidParamPipe()) id: string): Promise<TopicDetailDto> {
    return this.topics.get(id);
  }

  /** API-T-10: сохранение без смены статуса (REQ-TCH-TOP-06). */
  @Put(':id')
  @Owns('topic')
  @HttpCode(204)
  @ApiBody({ type: TopicBody })
  @ApiNoContentResponse()
  @ApiBadRequestResponse()
  @ApiUnprocessableEntityResponse({ description: 'Лимиты материалов BR-FILE-02' })
  save(
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(TopicContentDto)) dto: Dto<typeof TopicContentDto>,
    @Req() req: AuthRequest,
  ): Promise<void> {
    return this.topics.save(req.user!.id, id, dto);
  }

  /** API-T-11: ничего не сохраняет. */
  @Post(':id/ai-draft')
  @Owns('topic')
  @HttpCode(200)
  @ApiBody({ type: AiDraftBody })
  @ApiOkResponse({ type: AiDraftResponse })
  @ApiServiceUnavailableResponse({ description: '«ИИ-черновик сейчас недоступен» (PH-19)' })
  draft(
    @Param('id', new UuidParamPipe()) _id: string,
    @Body(new ZodValidationPipe(AiDraftDto)) dto: Dto<typeof AiDraftDto>,
  ): Promise<AiDraftResponse> {
    return this.aiDraft.draft(dto.title ?? '');
  }

  /** API-T-12 */
  @Post(':id/publish')
  @Owns('topic')
  @HttpCode(200)
  @ApiBody({ type: PublishBody })
  @ApiOkResponse({ type: PublishResultDto })
  @ApiBadRequestResponse({ description: 'У темы нет названия ни на одном языке' })
  publish(
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(PublishDto)) dto: Dto<typeof PublishDto>,
    @Req() req: AuthRequest,
  ): Promise<PublishResultDto> {
    return this.topics.publish(req.user!.id, id, dto);
  }

  /** API-T-13 (PH-27) */
  @Post(':id/unpublish')
  @Owns('topic')
  @HttpCode(200)
  @ApiOkResponse({ type: PublishResultDto })
  @ApiConflictResponse({ description: 'INVALID_TRANSITION: тема не опубликована' })
  unpublish(
    @Param('id', new UuidParamPipe()) id: string,
    @Req() req: AuthRequest,
  ): Promise<PublishResultDto> {
    return this.topics.unpublish(req.user!.id, id);
  }

  /** API-T-14 (PH-25) */
  @Get(':id/versions')
  @Owns('topic')
  @ApiOkResponse({ type: TopicVersionDto, isArray: true })
  versions(@Param('id', new UuidParamPipe()) id: string): Promise<TopicVersionDto[]> {
    return this.topics.versions(id);
  }

  /** API-T-15 */
  @Get(':id/preview')
  @Owns('topic')
  @ApiOkResponse({ type: LessonDto })
  preview(@Param('id', new UuidParamPipe()) id: string, @Req() req: AuthRequest): Promise<LessonDto> {
    return this.topics.preview(id, locale(req));
  }
}

/** Ученик: каталог и тема (6.5; интерфейс — итерация 8). */
@ApiTags('student')
@Controller('student')
@Roles('student')
export class StudentContentController {
  constructor(private readonly content: StudentContentService) {}

  /** API-S-04 */
  @Get('catalog')
  @ApiOkResponse({ type: CatalogDto })
  catalog(@Req() req: AuthRequest): Promise<CatalogDto> {
    return this.content.catalog(req.user!.id, locale(req));
  }

  /** API-S-05 (REQ-ST-CAT-03) */
  @Get('sections/:id')
  @ApiOkResponse({ type: SectionDto })
  @ApiNotFoundResponse()
  section(@Param('id', new UuidParamPipe()) id: string, @Req() req: AuthRequest): Promise<SectionDto> {
    return this.content.section(req.user!.id, id, locale(req));
  }

  /** Страница предмета ученика (решение владельца 2026-10-14): невидимый предмет → 404 (BR-VIS-01). */
  @Get('subjects/:id')
  @ApiOkResponse({ type: StudentSubjectDto })
  @ApiNotFoundResponse()
  subject(@Param('id', new UuidParamPipe()) id: string, @Req() req: AuthRequest): Promise<StudentSubjectDto> {
    return this.content.subject(req.user!.id, id, locale(req));
  }

  /** API-S-17 (REQ-ST-LES-04): повтор с тем же ключом не создаёт события. */
  @Post('events')
  @HttpCode(204)
  @ApiBody({ type: LessonEventBody })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Тема недоступна' })
  events(
    @Body(new ZodValidationPipe(LessonEventDto)) dto: Dto<typeof LessonEventDto>,
    @Req() req: AuthRequest,
  ): Promise<void> {
    return this.content.lessonOpened(req.user!.id, dto, locale(req));
  }

  /** API-S-06: черновик, архив и недоступный предмет → 404 (BR-VIS-01/02). */
  @Get('topics/:id')
  @ApiOkResponse({ type: LessonDto })
  @ApiNotFoundResponse()
  topic(@Param('id', new UuidParamPipe()) id: string, @Req() req: AuthRequest): Promise<LessonDto> {
    return this.content.topic(req.user!.id, id, locale(req));
  }
}
