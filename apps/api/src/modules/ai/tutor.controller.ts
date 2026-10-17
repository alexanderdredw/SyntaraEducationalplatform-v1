import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBody, ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type Response } from 'express';
import { StudentConversationDto, StudentMessageDto } from '@syntara/shared';
import { type Dto } from '../../common/dto';
import { resolveLocale } from '../../common/locale';
import { RateLimit } from '../../common/rate-limit';
import { UuidParamPipe } from '../../common/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Roles } from '../auth/auth.guards';
import { type AuthRequest } from '../auth/auth.types';
import { Owns } from '../content/ownership.guard';
import { ConversationBody, ConversationCreatedDto, ConversationDto, MessageBody } from './tutor.dto';
import { TutorService } from './tutor.service';

const locale = (req: AuthRequest) => resolveLocale(req.headers['accept-language']);

/** Учебный ИИ ученика (6.5, 8.4.5). Чужой диалог и диалог по невидимой теме → 404 (BR-ACL-03, BR-VIS-01). */
@ApiTags('student')
@Controller('student/ai/conversations')
@Roles('student')
export class TutorController {
  constructor(private readonly tutor: TutorService) {}

  /** API-S-11 */
  @Post()
  @HttpCode(200)
  @ApiBody({ type: ConversationBody })
  @ApiOkResponse({
    type: ConversationCreatedDto,
    description: 'Действующий диалог ученика по теме или общий',
  })
  @ApiNotFoundResponse({ description: 'Тема не найдена или не видна ученику' })
  open(
    @Body(new ZodValidationPipe(StudentConversationDto)) dto: Dto<typeof StudentConversationDto>,
    @Req() req: AuthRequest,
  ): Promise<ConversationCreatedDto> {
    return this.tutor.open(req.user!.id, dto);
  }

  /** API-S-13 */
  @Get(':id')
  @Owns('conversation')
  @ApiOkResponse({ type: ConversationDto })
  history(@Param('id', new UuidParamPipe()) id: string, @Req() req: AuthRequest): Promise<ConversationDto> {
    return this.tutor.history(id, locale(req));
  }

  /**
   * API-S-12: SSE `event: delta {text}` … `event: done {}` / `event: error {code}`; лимиты PH-20 на ученика.
   * Закрытие соединения клиентом отменяет генерацию, ответ сохраняется со status = partial (BR-AI-04).
   */
  @Post(':id/messages')
  @Owns('conversation')
  @RateLimit('aiStudent')
  @ApiBody({ type: MessageBody })
  @ApiOkResponse({
    description: 'Поток text/event-stream: delta {text} … done {} | error {code}',
    content: { 'text/event-stream': { schema: { type: 'string' } } },
  })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED: content ≤ 2000, quickAction из PH-21' })
  async ask(
    @Param('id', new UuidParamPipe()) id: string,
    @Body(new ZodValidationPipe(StudentMessageDto)) dto: Dto<typeof StudentMessageDto>,
    @Req() req: AuthRequest,
    @Res() res: Response,
  ): Promise<void> {
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });
    await this.tutor.ask(req.user!.id, id, dto, locale(req), res, controller.signal);
  }
}
