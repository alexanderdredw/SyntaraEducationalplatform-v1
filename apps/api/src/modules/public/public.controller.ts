import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { type Request } from 'express';
import { z } from 'zod';
import { DemoAnswerDto, SchoolsQuery } from '@syntara/shared';
import { type Dto } from '../../common/dto';
import { resolveLocale } from '../../common/locale';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { DemoService } from './demo.service';
import {
  DemoAnswerBody,
  DemoAnswerResponse,
  DemoQuestionDto,
  PublicConfigDto,
  PublicSubjectDto,
  SchoolDto,
} from './public.dto';
import { PublicService } from './public.service';

const localeHeader = ApiHeader({
  name: 'Accept-Language',
  required: false,
  description: 'ru, kk или en (API-GEN-03)',
});
const DemoQuery = z.object({ exclude: z.uuid().optional() });

/** Публичные операции без входа (раздел 6.2). */
@ApiTags('public')
@Controller('public')
export class PublicController {
  constructor(
    private readonly service: PublicService,
    private readonly demo: DemoService,
  ) {}

  /** API-PUB-01 */
  @Get('subjects')
  @localeHeader
  @ApiOkResponse({ type: PublicSubjectDto, isArray: true })
  subjects(@Req() req: Request): Promise<PublicSubjectDto[]> {
    return this.service.subjects(resolveLocale(req.headers['accept-language']));
  }

  /** API-PUB-02 */
  @Get('demo-question')
  @localeHeader
  @ApiQuery({ name: 'exclude', required: false, description: 'ID вопроса, который показать не нужно' })
  @ApiOkResponse({ type: DemoQuestionDto })
  @ApiNotFoundResponse({ description: 'Пробных вопросов нет' })
  demoQuestion(
    @Query(new ZodValidationPipe(DemoQuery)) query: Dto<typeof DemoQuery>,
    @Req() req: Request,
  ): Promise<DemoQuestionDto> {
    return this.demo.question(resolveLocale(req.headers['accept-language']), query.exclude);
  }

  /** API-PUB-03: ничего не сохраняет (BR-QZ-09). */
  @Post('demo-answer')
  @HttpCode(200)
  @localeHeader
  @ApiBody({ type: DemoAnswerBody })
  @ApiOkResponse({ type: DemoAnswerResponse })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Вопрос изменился — загрузите его заново' })
  demoAnswer(
    @Body(new ZodValidationPipe(DemoAnswerDto)) dto: Dto<typeof DemoAnswerDto>,
    @Req() req: Request,
  ): Promise<DemoAnswerResponse> {
    return this.demo.answer(dto, resolveLocale(req.headers['accept-language']));
  }

  /** API-PUB-09: поиск школы (≥ 2 символа), до 10 подтверждённых школ. */
  @Get('schools')
  @ApiQuery({ name: 'q', required: true, description: 'Часть названия или города' })
  @ApiOkResponse({ type: SchoolDto, isArray: true })
  schools(@Query(new ZodValidationPipe(SchoolsQuery)) query: Dto<typeof SchoolsQuery>): Promise<SchoolDto[]> {
    return this.service.schools(query.q);
  }

  /** API-PUB-07 */
  @Get('config')
  @ApiOkResponse({ type: PublicConfigDto })
  config(): Promise<PublicConfigDto> {
    return this.service.publicConfig();
  }
}
