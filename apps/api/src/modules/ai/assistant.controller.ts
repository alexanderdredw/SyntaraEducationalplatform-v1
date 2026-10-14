import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBody, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type Request, type Response } from 'express';
import { PublicAssistantDto } from '@syntara/shared';
import { type Dto } from '../../common/dto';
import { resolveLocale } from '../../common/locale';
import { RateLimit } from '../../common/rate-limit';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { PublicAssistantBody } from './ai.dto';
import { AssistantService } from './assistant.service';

@ApiTags('public')
@Controller('public')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  /**
   * API-PUB-06: SSE `event: delta {text}` … `event: done {}` / `event: error {code}`.
   * Лимиты PH-20 на IP (API-GEN-06); закрытие соединения клиентом отменяет генерацию.
   */
  @Post('assistant')
  @RateLimit('ai')
  @ApiHeader({ name: 'Accept-Language', required: false, description: 'Язык ответа' })
  @ApiBody({ type: PublicAssistantBody })
  @ApiOkResponse({
    description: 'Поток text/event-stream: delta {text} … done {} | error {code}',
    content: { 'text/event-stream': { schema: { type: 'string' } } },
  })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED: message ≤ 2000, history ≤ 20' })
  async ask(
    @Body(new ZodValidationPipe(PublicAssistantDto)) dto: Dto<typeof PublicAssistantDto>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });
    await this.assistant.stream(dto, resolveLocale(req.headers['accept-language']), res, controller.signal);
  }
}
