import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';
import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { type Response } from 'express';
import Redis from 'ioredis';
import {
  type AccountRegisteredPayload,
  EMAIL_TEMPLATES,
  type ForgotPasswordDto,
  type Locale,
  type LoginDto,
  OUTBOX_EVENT_TYPES,
  passwordResetKey,
  type PasswordResetPayload,
  type RegisterTeacherDto,
  type ResetPasswordDto,
} from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { enqueueEmail } from '../../common/outbox';
import { AppConfigService } from '../../config/app-config.service';
import { DB, REDIS } from '../../infra/tokens';
import { type MeDto } from '../users/me.dto';
import { MeService } from '../users/me.service';
import { createAccount } from './accounts';
import { SessionService, sortRoles } from './session.service';

/** Пароли — Argon2id (REQ-NFR-SEC-02). */
export const hashPassword = (password: string) => hash(password, { type: argon2id });

const invalidCredentials = () =>
  new ApiException(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', 'Invalid email or password');

@Injectable()
export class AuthService {
  /** Хеш-заглушка: проверка занимает одинаковое время, есть пользователь или нет. */
  private dummyHash?: Promise<string>;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly sessions: SessionService,
    private readonly me: MeService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * API-AUTH-01. Вход по email или по логину ученика (PH-44). Ошибка одна и та же для неизвестного
   * пользователя и неверного пароля.
   */
  async login(
    dto: LoginDto,
    userAgent: string | undefined,
    res: Response,
    previousSessionId?: string,
    preferredRole?: string,
  ): Promise<MeDto> {
    const { users, userRoles } = schema;
    const identifier = dto.email.trim();
    const [user] = await this.db
      .select({
        id: users.id,
        displayName: users.displayName,
        passwordHash: users.passwordHash,
        status: users.status,
      })
      .from(users)
      .where(
        identifier.includes('@') ? eq(users.email, identifier) : eq(users.login, identifier.toLowerCase()),
      );

    this.dummyHash ??= hashPassword('timing-equalizer');
    const stored = user?.passwordHash ?? (await this.dummyHash);
    const valid = await verify(stored, dto.password).catch(() => false);
    if (!user || !user.passwordHash || !valid || user.status !== 'active') throw invalidCredentials();

    const roles = await this.db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, user.id));
    if (roles.length === 0) throw invalidCredentials();

    // Новая сессия при каждом входе; прежняя (если была в этом браузере) отзывается.
    if (previousSessionId) await this.sessions.revoke(previousSessionId, res);
    await this.sessions.create(user.id, userAgent, res);
    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    return this.me.me(
      {
        id: user.id,
        displayName: user.displayName,
        roles: sortRoles(roles.map((r) => r.role)),
        sessionId: '',
      },
      preferredRole,
    );
  }

  /**
   * API-AUTH-03: регистрация учителя (PH-06, PH-17). Аккаунт, роль, предпочтения, согласие и письмо —
   * одной транзакцией; затем вход (cookie сессии).
   * TODO(OWNER): подтверждение email (Q-12) — нужен признак подтверждения в users (миграция); пока письмо
   * сообщает о регистрации, вход до подтверждения разрешён.
   */
  async registerTeacher(
    dto: RegisterTeacherDto,
    locale: Locale,
    userAgent: string | undefined,
    res: Response,
  ): Promise<MeDto> {
    await this.assertPasswordLength(dto.password);
    const passwordHash = await hashPassword(dto.password);
    const userId = await this.db.transaction(async (tx) => {
      const id = await createAccount(tx, {
        email: dto.email,
        login: null,
        displayName: dto.displayName,
        passwordHash,
        role: 'teacher',
        locale,
      });
      await enqueueEmail(tx, OUTBOX_EVENT_TYPES.emailAccount, EMAIL_TEMPLATES.accountRegistered, dto.email, {
        locale,
        displayName: dto.displayName,
      } satisfies AccountRegisteredPayload);
      return id;
    });
    await this.sessions.create(userId, userAgent, res);
    return this.me.me({ id: userId, displayName: dto.displayName, roles: ['teacher'], sessionId: '' });
  }

  /**
   * API-AUTH-04 (forgot): всегда 204 — ответ не раскрывает, есть ли аккаунт. Письмо со ссылкой
   * отправляет worker; сам токен создаётся при отправке и хранится только хешем.
   */
  async forgotPassword(dto: ForgotPasswordDto, locale: Locale): Promise<void> {
    const { users } = schema;
    const [user] = await this.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.email, dto.email), eq(users.status, 'active')));
    if (!user?.email) return;
    await this.db.transaction((tx) =>
      enqueueEmail(tx, OUTBOX_EVENT_TYPES.emailAccount, EMAIL_TEMPLATES.passwordReset, user.email!, {
        locale,
        userId: user.id,
      } satisfies PasswordResetPayload),
    );
  }

  /**
   * API-AUTH-04 (reset): токен одноразовый (GETDEL), после смены пароля все сессии пользователя отзываются.
   * TODO(OWNER): восстановление пароля для учеников без email (PH-44).
   */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    await this.assertPasswordLength(dto.password);
    if (this.redis.status === 'wait') await this.redis.connect();
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');
    const userId = await this.redis.getdel(passwordResetKey(tokenHash));
    if (!userId) {
      throw new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Invalid or expired token', {
        token: 'invalidToken',
      });
    }
    const passwordHash = await hashPassword(dto.password);
    const { users, authSessions } = schema;
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
      await tx
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)));
    });
  }

  /** PH-06: минимальная длина пароля из app_config (схема Zod проверяет значение по умолчанию). */
  private async assertPasswordLength(password: string): Promise<void> {
    const min = await this.config.get<number>('auth.password_min_length');
    if (password.length < min) {
      throw new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Password is too short', {
        password: 'passwordTooShort',
      });
    }
  }
}
