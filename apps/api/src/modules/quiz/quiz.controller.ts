import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { QuestionDto } from '@syntara/shared';
import { type Dto } from '../../common/dto';
import { UuidParamPipe } from '../../common/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Roles } from '../auth/auth.guards';
import { Owns } from '../content/ownership.guard';
import { QuestionBody, QuestionIdDto, QuizDto } from './quiz.dto';
import { QuizService } from './quiz.service';

/** Квиз темы для автора (6.4, 8.3.5). Чужая тема или вопрос → 404 (BR-ACL-01). */
@ApiTags('teacher')
@Controller('teacher')
@Roles('teacher')
export class TeacherQuizController {
  constructor(private readonly quiz: QuizService) {}

  /** API-T-19 */
  @Get('topics/:id/quiz')
  @Owns('topic')
  @ApiOkResponse({ type: QuizDto })
  get(@Param('id', new UuidParamPipe()) id: string): Promise<QuizDto> {
    return this.quiz.get(id);
  }

  /** API-T-20: два правильных или один вариант → 400, вопрос не создаётся (AC-TCH-07). */
  @Post('topics/:id/quiz/questions')
  @Owns('topic')
  @HttpCode(201)
  @ApiBody({ type: QuestionBody })
  @ApiCreatedResponse({ type: QuestionIdDto })
  @ApiBadRequestResponse({ description: 'min2 / max8 / exactlyOneCorrect / atLeastOneLanguage' })
  create(
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(QuestionDto)) dto: Dto<typeof QuestionDto>,
  ): Promise<QuestionIdDto> {
    return this.quiz.create(id, dto);
  }

  /** API-T-21 PUT: ответ — id вопроса (новый, если на старый уже отвечали). */
  @Put('questions/:id')
  @Owns('question')
  @HttpCode(200)
  @ApiBody({ type: QuestionBody })
  @ApiOkResponse({ type: QuestionIdDto })
  @ApiBadRequestResponse()
  update(
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(QuestionDto)) dto: Dto<typeof QuestionDto>,
  ): Promise<QuestionIdDto> {
    return this.quiz.update(id, dto);
  }

  /** API-T-21 DELETE: архивирование. */
  @Delete('questions/:id')
  @Owns('question')
  @HttpCode(204)
  @ApiNoContentResponse()
  archive(@Param('id', new UuidParamPipe()) id: string): Promise<void> {
    return this.quiz.archive(id);
  }
}
