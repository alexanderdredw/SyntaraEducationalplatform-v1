import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AnswerDto } from '@syntara/shared';
import { type Dto } from '../../common/dto';
import { resolveLocale } from '../../common/locale';
import { UuidParamPipe } from '../../common/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Roles } from '../auth/auth.guards';
import { Owns } from '../content/ownership.guard';
import { type AuthRequest } from '../auth/auth.types';
import { AnswerBody, AnsweredDto, AnswerResultDto, AttemptDto, FinishResultDto } from './student-quiz.dto';
import { StudentQuizService } from './student-quiz.service';

const locale = (req: AuthRequest) => resolveLocale(req.headers['accept-language']);

/** Квиз ученика (6.5, 8.4.4, SM-ATTEMPT). Невидимая тема и чужая попытка → 404 (BR-VIS-01, BR-ACL-03). */
@ApiTags('student')
@Controller('student')
@Roles('student')
@ApiExtraModels(AnsweredDto)
export class StudentQuizController {
  constructor(private readonly quiz: StudentQuizService) {}

  /** API-S-07 */
  @Post('quizzes/:quizId/attempts')
  @HttpCode(200)
  @ApiOkResponse({ type: AttemptDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'В квизе нет вопросов' })
  start(@Param('quizId', new UuidParamPipe()) quizId: string, @Req() req: AuthRequest): Promise<AttemptDto> {
    return this.quiz.start(req.user!.id, quizId, locale(req));
  }

  /** API-S-08 */
  @Post('attempts/:id/answers')
  @Owns('attempt')
  @HttpCode(200)
  @ApiBody({ type: AnswerBody })
  @ApiOkResponse({ type: AnswerResultDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'INVALID_TRANSITION: попытка завершена' })
  answer(
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(AnswerDto)) dto: Dto<typeof AnswerDto>,
    @Req() req: AuthRequest,
  ): Promise<AnswerResultDto> {
    return this.quiz.answer(req.user!.id, id, dto, locale(req));
  }

  /** API-S-09 */
  @Post('attempts/:id/finish')
  @Owns('attempt')
  @HttpCode(200)
  @ApiOkResponse({ type: FinishResultDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'INVALID_TRANSITION: попытка уже завершена' })
  finish(@Param('id', new UuidParamPipe()) id: string, @Req() req: AuthRequest): Promise<FinishResultDto> {
    return this.quiz.finish(req.user!.id, id, locale(req));
  }
}
