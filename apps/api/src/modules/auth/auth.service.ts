import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';
import { createHash } from 'node:crypto';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { type Response } from 'express';
import Redis from 'ioredis';
import {
  type AccountNoticePayload,
  type AccountRegisteredPayload,
  type ChangePasswordDto,
  emailChangeKey,
  emailVerifyKey,
  type EmailVerifyPayload,
  EMAIL_TEMPLATES,
  type ForgotPasswordDto,
  type Locale,
  type LoginDto,
  OUTBOX_EVENT_TYPES,
  passwordResetKey,
  type PasswordResetPayload,
  type RegisterTeacherDto,
  type ResetPasswordDto,
  type VerifyEmailDto,
} from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { isUniqueViolation } from '../../common/idempotency';
import { enqueueEmail } from '../../common/outbox';
import { AuditService } from '../audit/audit.service';
import { AppConfigService } from '../../config/app-config.service';
import { DB, REDIS } from '../../infra/tokens';
import { type MeDto } from '../users/me.dto';
import { MeService } from '../users/me.service';
import { createAccount } from './accounts';
import { type AuthUser } from './auth.types';
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
    private readonly audit: AuditService,
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

    // BR-AUTH-01: вход привязан к форме роли. Проверка — после пароля (неверный пароль не раскрывает ни роль,
    // ни существование аккаунта); при несовпадении сессия не создаётся.
    if (dto.role) {
      const owned = roles.map((r) => r.role);
      if (!owned.includes(dto.role)) {
        const expected = owned.find((r): r is 'student' | 'teacher' => r === 'student' || r === 'teacher');
        // Только служебная роль — форм учителя и ученика для неё нет: прежний общий ответ.
        // TODO(OWNER): подсказка для сотрудника, вошедшего через форму учителя или ученика.
        if (!expected) throw invalidCredentials();
        throw new ApiException(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          'Wrong login form for this account',
          { login: 'wrongRoleForLogin' },
          undefined,
          undefined,
          expected,
        );
      }
      preferredRole = dto.role;
    }

    // Новая сессия при каждом входе; прежняя (если была в этом браузере) отзывается.
    if (previousSessionId) await this.sessions.revoke(previousSessionId, res);
    await this.sessions.create(user.id, userAgent, res);
    // BR-AUTH-01: аккаунт с обеими ролями — активна роль формы.
    if (dto.role) this.sessions.setActiveRole(res, dto.role);
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
   * Письмо содержит ссылку подтверждения email (API-AUTH-06); вход до подтверждения разрешён (решение владельца
   * 2026-10-14), в кабинете — напоминание «Подтвердите email».
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
        userId: id,
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

  /**
   * API-AUTH-05: смена пароля вошедшим пользователем. При временном пароле от учителя (mustChangePassword)
   * текущий пароль не нужен; иначе он обязателен и проверяется, новый не равен текущему (BR-PRF-08).
   * Остальные сессии пользователя завершаются, текущая остаётся; письмо «Пароль изменён», если есть email.
   */
  async changePassword(user: AuthUser, dto: ChangePasswordDto): Promise<void> {
    await this.assertPasswordLength(dto.password);
    const { users, authSessions, userPreferences } = schema;
    const [row] = await this.db
      .select({ passwordHash: users.passwordHash, mustChange: users.mustChangePassword, email: users.email })
      .from(users)
      .where(eq(users.id, user.id));
    if (!row) throw invalidCredentials();
    if (!row.mustChange) {
      if (!dto.currentPassword) {
        throw new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Current password is required', {
          currentPassword: 'required',
        });
      }
      const ok = row.passwordHash
        ? await verify(row.passwordHash, dto.currentPassword).catch(() => false)
        : false;
      if (!ok) {
        throw new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Current password is wrong', {
          currentPassword: 'invalidPassword',
        });
      }
      if (dto.password === dto.currentPassword) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_FAILED',
          'New password equals the current one',
          {
            password: 'samePassword',
          },
        );
      }
    }
    const passwordHash = await hashPassword(dto.password);
    const [prefs] = await this.db
      .select({ locale: userPreferences.locale })
      .from(userPreferences)
      .where(eq(userPreferences.userId, user.id));
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash, mustChangePassword: false }).where(eq(users.id, user.id));
      await this.audit.record(
        { actorId: user.id, entityType: 'user', entityId: user.id, action: 'account.password' },
        tx,
      );
      // Временный пароль от учителя — не «смена по желанию»: уведомление только при обычной смене.
      if (row.email && !row.mustChange) {
        await enqueueEmail(tx, OUTBOX_EVENT_TYPES.emailAccount, EMAIL_TEMPLATES.passwordChanged, row.email, {
          locale: (prefs?.locale ?? 'ru') as Locale,
        } satisfies AccountNoticePayload);
      }
      await tx
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(authSessions.userId, user.id),
            isNull(authSessions.revokedAt),
            ne(authSessions.id, user.sessionId),
          ),
        );
    });
  }

  /**
   * API-AUTH-06: подтверждение email по одноразовому токену из письма. Токен смены email (BR-PRF-07, API-ME-10)
   * подтверждает новый адрес: он становится email аккаунта, на прежний уходит «Ваш email изменён». Адрес, занятый
   * к моменту подтверждения, — 400 emailUnavailable (существование аккаунта не раскрывается).
   */
  async verifyEmail(dto: VerifyEmailDto): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect();
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');
    const userId = await this.redis.getdel(emailVerifyKey(tokenHash));
    if (userId) {
      await this.db
        .update(schema.users)
        .set({ emailVerifiedAt: new Date() })
        .where(eq(schema.users.id, userId));
      return;
    }
    const change = await this.redis.getdel(emailChangeKey(tokenHash));
    if (!change) {
      throw new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Invalid or expired token', {
        token: 'invalidToken',
      });
    }
    await this.confirmEmailChange(JSON.parse(change) as { userId: string; email: string });
  }

  /** BR-PRF-07: новый адрес подтверждён — меняется email аккаунта, уведомление на прежний адрес. */
  private async confirmEmailChange({ userId, email }: { userId: string; email: string }): Promise<void> {
    const { users, userPreferences } = schema;
    const [prefs] = await this.db
      .select({ locale: userPreferences.locale })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    const unavailable = () =>
      new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Email cannot be used', {
        email: 'emailUnavailable',
      });
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select({ email: users.email })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.status, 'active')))
        .for('update');
      if (!before) throw unavailable();
      const [taken] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, email), ne(users.id, userId)));
      if (taken) throw unavailable();
      try {
        await tx.transaction((sp) =>
          sp.update(users).set({ email, emailVerifiedAt: new Date() }).where(eq(users.id, userId)),
        );
      } catch (err) {
        if (isUniqueViolation(err)) throw unavailable();
        throw err;
      }
      await this.audit.record(
        {
          actorId: userId,
          entityType: 'user',
          entityId: userId,
          action: 'account.email',
          before: { email: before.email },
          after: { email },
        },
        tx,
      );
      if (before.email && before.email.toLowerCase() !== email.toLowerCase()) {
        await enqueueEmail(tx, OUTBOX_EVENT_TYPES.emailAccount, EMAIL_TEMPLATES.emailChanged, before.email, {
          locale: (prefs?.locale ?? 'ru') as Locale,
        } satisfies AccountNoticePayload);
      }
    });
  }

  /** API-AUTH-06: повторная отправка ссылки — только вошедшему пользователю с неподтверждённым email. */
  async resendVerification(user: AuthUser, locale: Locale): Promise<void> {
    const { users } = schema;
    const [row] = await this.db
      .select({ email: users.email, verifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, user.id));
    if (!row?.email || row.verifiedAt) {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Nothing to verify');
    }
    await this.db.transaction((tx) =>
      enqueueEmail(tx, OUTBOX_EVENT_TYPES.emailAccount, EMAIL_TEMPLATES.emailVerify, row.email!, {
        locale,
        userId: user.id,
      } satisfies EmailVerifyPayload),
    );
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
