import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import {
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { type Response } from 'express';
import { LoginDto } from '@syntara/shared';
import { RateLimit } from '../../common/rate-limit';
import { type Dto } from '../../common/dto';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { LoginBody, LoginResponse } from './auth.dto';
import { Roles } from './auth.guards';
import { AuthService } from './auth.service';
import { type AuthRequest } from './auth.types';
import { SessionService } from './session.service';

/** Аутентификация (6.3). Регистрация и сброс пароля — итерация 6. */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  /** API-AUTH-01: 200 { user } + cookie `sid` (HttpOnly) и `csrf`. Лимит — 10 за 15 минут на IP+email. */
  @Post('login')
  @HttpCode(200)
  @RateLimit('login')
  @ApiBody({ type: LoginBody })
  @ApiOkResponse({ type: LoginResponse })
  @ApiUnauthorizedResponse({ description: 'Неверный email или пароль' })
  async login(
    @Body(new ZodValidationPipe(LoginDto)) dto: Dto<typeof LoginDto>,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const user = await this.auth.login(dto, req.headers['user-agent'], res, req.user?.sessionId);
    return { user };
  }

  /** API-AUTH-02 */
  @Post('logout')
  @HttpCode(204)
  @Roles()
  @ApiNoContentResponse()
  async logout(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.sessions.revoke(req.user!.sessionId, res);
  }
}
