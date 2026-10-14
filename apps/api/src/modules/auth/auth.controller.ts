import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { type Response } from 'express';
import { ForgotPasswordDto, LoginDto, RegisterTeacherDto, ResetPasswordDto } from '@syntara/shared';
import { type Dto } from '../../common/dto';
import { resolveLocale } from '../../common/locale';
import { RateLimit } from '../../common/rate-limit';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import {
  ForgotPasswordBody,
  LoginBody,
  LoginResponse,
  RegisterTeacherBody,
  ResetPasswordBody,
} from './auth.dto';
import { Roles } from './auth.guards';
import { AuthService } from './auth.service';
import { ACTIVE_ROLE_COOKIE, type AuthRequest } from './auth.types';
import { SessionService } from './session.service';

/** Аутентификация (6.3). */
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
  @ApiUnauthorizedResponse({ description: 'Неверный email/логин или пароль' })
  async login(
    @Body(new ZodValidationPipe(LoginDto)) dto: Dto<typeof LoginDto>,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
    const user = await this.auth.login(
      dto,
      req.headers['user-agent'],
      res,
      req.user?.sessionId,
      cookies[ACTIVE_ROLE_COOKIE],
    );
    return { user };
  }

  /** API-AUTH-03: регистрация учителя; сразу выполняется вход. Лимит — как у публичных форм. */
  @Post('register')
  @HttpCode(201)
  @RateLimit('forms')
  @ApiBody({ type: RegisterTeacherBody })
  @ApiCreatedResponse({ type: LoginResponse })
  @ApiConflictResponse({ description: 'Email уже зарегистрирован (fieldErrors.email = emailTaken)' })
  async register(
    @Body(new ZodValidationPipe(RegisterTeacherDto)) dto: Dto<typeof RegisterTeacherDto>,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const user = await this.auth.registerTeacher(
      dto,
      resolveLocale(req.headers['accept-language']),
      req.headers['user-agent'],
      res,
    );
    return { user };
  }

  /** API-AUTH-04: ответ всегда 204 — существование аккаунта не раскрывается. */
  @Post('password/forgot')
  @HttpCode(204)
  @RateLimit('forms')
  @ApiBody({ type: ForgotPasswordBody })
  @ApiNoContentResponse()
  forgot(
    @Body(new ZodValidationPipe(ForgotPasswordDto)) dto: Dto<typeof ForgotPasswordDto>,
    @Req() req: AuthRequest,
  ): Promise<void> {
    return this.auth.forgotPassword(dto, resolveLocale(req.headers['accept-language']));
  }

  /** API-AUTH-04: новый пароль по одноразовому токену из письма; все сессии пользователя завершаются. */
  @Post('password/reset')
  @HttpCode(204)
  @RateLimit('forms')
  @ApiBody({ type: ResetPasswordBody })
  @ApiNoContentResponse()
  reset(@Body(new ZodValidationPipe(ResetPasswordDto)) dto: Dto<typeof ResetPasswordDto>): Promise<void> {
    return this.auth.resetPassword(dto);
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
