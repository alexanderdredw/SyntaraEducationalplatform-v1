import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiTags,
} from '@nestjs/swagger';
import { type Response } from 'express';
import { SchoolRequestDto, SupportTicketDto } from '@syntara/shared';
import { IdempotencyKey } from '../../common/idempotency';
import { resolveLocale } from '../../common/locale';
import { RateLimit } from '../../common/rate-limit';
import { type Dto } from '../../common/dto';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { type AuthRequest } from '../auth/auth.types';
import { FormCreatedResponse, SchoolRequestBody, SupportTicketBody } from './support.dto';
import { type FormCreated, FormsService } from './forms.service';

const idempotencyHeader = ApiHeader({
  name: 'Idempotency-Key',
  required: true,
  description: 'UUID; тот же ключ и то же тело → прежний ответ (API-GEN-05)',
});
const localeHeader = ApiHeader({ name: 'Accept-Language', required: false, description: 'Язык письма' });

/** Публичные формы (6.2): лимит 5 в минуту на IP (API-GEN-06). */
@ApiTags('public')
@Controller('public')
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  /** API-PUB-04 */
  @Post('school-requests')
  @HttpCode(201)
  @RateLimit('forms')
  @idempotencyHeader
  @localeHeader
  @ApiBody({ type: SchoolRequestBody })
  @ApiCreatedResponse({ type: FormCreatedResponse })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED; fieldErrors — ключи i18n validation.*' })
  @ApiConflictResponse({ description: 'IDEMPOTENCY_MISMATCH' })
  async schoolRequest(
    @Body(new ZodValidationPipe(SchoolRequestDto)) dto: Dto<typeof SchoolRequestDto>,
    @IdempotencyKey() key: string,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FormCreated> {
    const result = await this.forms.createSchoolRequest(
      dto,
      req.body,
      key,
      resolveLocale(req.headers['accept-language']),
    );
    res.status(result.status);
    return result.body;
  }

  /** API-PUB-05. Обращение вошедшего пользователя связывается с его аккаунтом. */
  @Post('support-tickets')
  @HttpCode(201)
  @RateLimit('forms')
  @idempotencyHeader
  @localeHeader
  @ApiBody({ type: SupportTicketBody })
  @ApiCreatedResponse({ type: FormCreatedResponse })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED; fieldErrors — ключи i18n validation.*' })
  @ApiConflictResponse({ description: 'IDEMPOTENCY_MISMATCH' })
  async supportTicket(
    @Body(new ZodValidationPipe(SupportTicketDto)) dto: Dto<typeof SupportTicketDto>,
    @IdempotencyKey() key: string,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FormCreated> {
    const result = await this.forms.createSupportTicket(
      dto,
      req.body,
      key,
      resolveLocale(req.headers['accept-language']),
      req.user?.id ?? null,
    );
    res.status(result.status);
    return result.body;
  }
}
