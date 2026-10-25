import { Body, Controller, Delete, HttpCode, Post, Req } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { EmailChangeDto, EmailRemoveDto } from '@syntara/shared';
import { type Dto } from '../../common/dto';
import { RateLimit } from '../../common/rate-limit';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Roles } from '../auth/auth.guards';
import { type AuthRequest } from '../auth/auth.types';
import { AccountService } from './account.service';

class EmailChangeBody {
  @ApiProperty() email: string;
  @ApiProperty() currentPassword: string;
}

class EmailRemoveBody {
  @ApiProperty() currentPassword: string;
}

/** «Настройки аккаунта» ученика и учителя (SPEC 8.7, REQ-PRF-06/08): email и устройства. */
@ApiTags('auth')
@Controller('me')
@Roles('student', 'teacher')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  /** API-ME-10 POST: письмо со ссылкой подтверждения на новый адрес (BR-PRF-07). */
  @Post('email')
  @HttpCode(202)
  @RateLimit('email')
  @ApiBody({ type: EmailChangeBody })
  @ApiAcceptedResponse({
    description: 'Письмо отправлено на новый адрес; до подтверждения действует прежний',
  })
  @ApiBadRequestResponse({
    description: 'invalidPassword; emailUnavailable — «Этот адрес нельзя использовать»',
  })
  async requestEmailChange(
    @Body(new ZodValidationPipe(EmailChangeDto)) dto: Dto<typeof EmailChangeDto>,
    @Req() req: AuthRequest,
  ): Promise<void> {
    await this.account.requestEmailChange(req.user!, dto);
  }

  /** API-ME-10 DELETE: удалить email — только ученик с логином (BR-PRF-07). */
  @Delete('email')
  @HttpCode(204)
  @RateLimit('email')
  @ApiBody({ type: EmailRemoveBody })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ description: 'Учитель или ученик без логина' })
  removeEmail(
    @Body(new ZodValidationPipe(EmailRemoveDto)) dto: Dto<typeof EmailRemoveDto>,
    @Req() req: AuthRequest,
  ): Promise<void> {
    return this.account.removeEmail(req.user!, dto);
  }

  /** API-ME-11 */
  @Post('sessions/revoke-others')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Все сессии, кроме текущей, завершены' })
  revokeOthers(@Req() req: AuthRequest): Promise<void> {
    return this.account.revokeOtherSessions(req.user!);
  }
}
