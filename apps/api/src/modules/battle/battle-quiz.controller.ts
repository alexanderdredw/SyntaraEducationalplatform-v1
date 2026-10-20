import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  BattleImportDto,
  BattleListQuery,
  BattleQuestionDto,
  BattleQuizCreateDto,
  BattleQuizUpdateDto,
  BattleReorderDto,
} from '@syntara/shared';
import { type Dto } from '../../common/dto';
import { resolveLocale } from '../../common/locale';
import { UuidParamPipe } from '../../common/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Roles } from '../auth/auth.guards';
import { type AuthRequest } from '../auth/auth.types';
import { Owns } from '../content/ownership.guard';
import {
  BattleIdDto,
  BattleImportBody,
  BattleImportedDto,
  BattleImportSourceDto,
  BattleQuestionBody,
  BattleQuizCreateBody,
  BattleQuizDto,
  BattleQuizListItemDto,
  BattleQuizUpdateBody,
  BattleReorderBody,
} from './battle.dto';
import { BattleQuizService } from './battle-quiz.service';

const locale = (req: AuthRequest) => resolveLocale(req.headers['accept-language']);

/** Battle-тесты учителя (SPEC 6.8, 8.6.1). Чужой тест или вопрос → 404 (BR-BTL-12). */
@ApiTags('teacher')
@Controller('teacher/battles')
@Roles('teacher')
export class BattleQuizController {
  constructor(private readonly battles: BattleQuizService) {}

  /** API-BTL-01 */
  @Get()
  @ApiQuery({ name: 'archived', required: false, enum: ['true', 'false'] })
  @ApiOkResponse({ type: BattleQuizListItemDto, isArray: true })
  list(
    @Query(new ZodValidationPipe(BattleListQuery)) query: Dto<typeof BattleListQuery>,
    @Req() req: AuthRequest,
  ): Promise<BattleQuizListItemDto[]> {
    return this.battles.list(req.user!.id, query.archived);
  }

  /** API-BTL-02 */
  @Post()
  @HttpCode(201)
  @ApiBody({ type: BattleQuizCreateBody })
  @ApiCreatedResponse({ type: BattleIdDto })
  create(
    @Body(new ZodValidationPipe(BattleQuizCreateDto)) dto: Dto<typeof BattleQuizCreateDto>,
    @Req() req: AuthRequest,
  ): Promise<BattleIdDto> {
    return this.battles.create(req.user!.id, dto);
  }

  /** API-BTL-10 (объявлен до `:id`, иначе путь совпал бы с ID теста). */
  @Get('import-sources')
  @ApiOkResponse({ type: BattleImportSourceDto, isArray: true })
  importSources(@Req() req: AuthRequest): Promise<BattleImportSourceDto[]> {
    return this.battles.importSources(req.user!.id, locale(req));
  }

  /** API-BTL-03 */
  @Get(':id')
  @Owns('battle')
  @ApiOkResponse({ type: BattleQuizDto })
  get(@Param('id', new UuidParamPipe()) id: string): Promise<BattleQuizDto> {
    return this.battles.get(id);
  }

  /** API-BTL-04 */
  @Patch(':id')
  @Owns('battle')
  @HttpCode(204)
  @ApiBody({ type: BattleQuizUpdateBody })
  @ApiNoContentResponse()
  update(
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(BattleQuizUpdateDto)) dto: Dto<typeof BattleQuizUpdateDto>,
  ): Promise<void> {
    return this.battles.update(id, dto);
  }

  /** API-BTL-05 */
  @Post(':id/duplicate')
  @Owns('battle')
  @HttpCode(201)
  @ApiCreatedResponse({ type: BattleIdDto })
  duplicate(@Param('id', new UuidParamPipe()) id: string, @Req() req: AuthRequest): Promise<BattleIdDto> {
    return this.battles.duplicate(req.user!.id, id);
  }

  /** API-BTL-06 */
  @Post(':id/questions')
  @Owns('battle')
  @HttpCode(201)
  @ApiBody({ type: BattleQuestionBody })
  @ApiCreatedResponse({ type: BattleIdDto })
  @ApiUnprocessableEntityResponse({
    description: 'tooManyQuestions (> 50) / invalidFile (картинка не из галереи)',
  })
  addQuestion(
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(BattleQuestionDto)) dto: Dto<typeof BattleQuestionDto>,
    @Req() req: AuthRequest,
  ): Promise<BattleIdDto> {
    return this.battles.addQuestion(req.user!.id, id, dto);
  }

  /** API-BTL-09 (объявлен до `questions/:qid`). */
  @Post(':id/questions/reorder')
  @Owns('battle')
  @HttpCode(204)
  @ApiBody({ type: BattleReorderBody })
  @ApiNoContentResponse()
  @ApiUnprocessableEntityResponse({ description: 'invalidOrder — нужны все неархивные вопросы теста' })
  reorder(
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(BattleReorderDto)) dto: Dto<typeof BattleReorderDto>,
  ): Promise<void> {
    return this.battles.reorder(id, dto);
  }

  /** API-BTL-07 */
  @Patch(':id/questions/:qid')
  @Owns('battle')
  @HttpCode(204)
  @ApiBody({ type: BattleQuestionBody })
  @ApiNoContentResponse()
  updateQuestion(
    @Param('id', new UuidParamPipe()) id: string,
    @Param('qid', new UuidParamPipe()) qid: string,
    @Body(new ZodValidationPipe(BattleQuestionDto)) dto: Dto<typeof BattleQuestionDto>,
    @Req() req: AuthRequest,
  ): Promise<void> {
    return this.battles.updateQuestion(req.user!.id, id, qid, dto);
  }

  /** API-BTL-08 */
  @Delete(':id/questions/:qid')
  @Owns('battle')
  @HttpCode(204)
  @ApiNoContentResponse()
  archiveQuestion(
    @Param('id', new UuidParamPipe()) id: string,
    @Param('qid', new UuidParamPipe()) qid: string,
  ): Promise<void> {
    return this.battles.archiveQuestion(id, qid);
  }

  /** API-BTL-11 */
  @Post(':id/import')
  @Owns('battle')
  @HttpCode(200)
  @ApiBody({ type: BattleImportBody })
  @ApiOkResponse({ type: BattleImportedDto })
  @ApiUnprocessableEntityResponse({ description: 'tooManyQuestions / notEligible' })
  importQuestions(
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(BattleImportDto)) dto: Dto<typeof BattleImportDto>,
    @Req() req: AuthRequest,
  ): Promise<BattleImportedDto> {
    return this.battles.importQuestions(req.user!.id, id, dto);
  }
}
