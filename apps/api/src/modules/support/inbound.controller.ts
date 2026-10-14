import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBody, ApiNoContentResponse, ApiNotFoundResponse, ApiTags } from '@nestjs/swagger';
import { InboundEmailDto } from '@syntara/shared';
import { ApiException } from '../../common/api-exception';
import { type Dto } from '../../common/dto';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { FEATURE_FLAGS, FeatureFlagsService } from '../../config/feature-flags.service';
import { SkipCsrf } from '../auth/auth.guards';
import { InboundService } from './inbound.service';
import { InboundEmailBody } from './support.dto';

/** API-SUP-08. Выключен флагом `support.inbound_email` до подключения почтового провайдера (Q-10). */
@ApiTags('staff')
@Controller('inbound')
export class InboundController {
  constructor(
    private readonly inbound: InboundService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Post('email')
  @HttpCode(204)
  @SkipCsrf()
  @ApiBody({ type: InboundEmailBody })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Функция выключена или токен не найден' })
  async email(@Body(new ZodValidationPipe(InboundEmailDto)) dto: Dto<typeof InboundEmailDto>): Promise<void> {
    if (!(await this.flags.isEnabled(FEATURE_FLAGS.inboundEmail))) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
    }
    await this.inbound.receive(dto);
  }
}
