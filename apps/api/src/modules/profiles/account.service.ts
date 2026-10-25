import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { verify } from 'argon2';
import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import {
  EMAIL_TEMPLATES,
  type EmailChangeDto,
  type EmailChangePayload,
  type EmailRemoveDto,
  type Locale,
  OUTBOX_EVENT_TYPES,
  parseUserAgent,
} from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { enqueueEmail } from '../../common/outbox';
import { DB } from '../../infra/tokens';
import { AuditService } from '../audit/audit.service';
import { type AuthUser } from '../auth/auth.types';
import { type SessionItemDto } from './account.controller';

const { users, userPreferences, authSessions } = schema;

const unavailable = () =>
  new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Email cannot be used', {
    email: 'emailUnavailable',
  });

/**
 * Настройки аккаунта (SPEC 7.15; API-ME-10, API-ME-11): email и устройства. Смена пароля — API-AUTH-05 (AuthService).
 * Изменения email требуют текущий пароль (BR-PRF-07); лимит попыток — RateLimit('email').
 */
@Injectable()
export class AccountService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /**
   * API-ME-10 POST: письмо со ссылкой на новый адрес (24 ч); до подтверждения действует прежний адрес (или его нет).
   * Адрес занят другим аккаунтом или совпадает с текущим — «Этот адрес нельзя использовать» без подробностей.
   */
  async requestEmailChange(user: AuthUser, dto: EmailChangeDto): Promise<void> {
    const account = await this.checkPassword(user, dto.currentPassword);
    if (account.email?.toLowerCase() === dto.email) throw unavailable();
    const [taken] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, dto.email), ne(users.id, user.id)));
    if (taken) throw unavailable();
    const locale = await this.locale(user.id);
    await this.db.transaction(async (tx) => {
      await enqueueEmail(tx, OUTBOX_EVENT_TYPES.emailAccount, EMAIL_TEMPLATES.emailChange, dto.email, {
        locale,
        userId: user.id,
        email: dto.email,
      } satisfies EmailChangePayload);
      await this.audit.record(
        {
          actorId: user.id,
          entityType: 'user',
          entityId: user.id,
          action: 'account.email_requested',
          before: { email: account.email },
          after: { email: dto.email },
        },
        tx,
      );
    });
  }

  /**
   * API-ME-10 DELETE (BR-PRF-07): удалить email может только ученик с логином — восстановление пароля тогда через
   * учителя (API-T-27). Учителю нельзя: email — его логин. Аккаунт без email — child-safe (5.3 CHECK).
   */
  async removeEmail(user: AuthUser, dto: EmailRemoveDto): Promise<void> {
    if (user.roles.includes('teacher') || !user.roles.includes('student')) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Only a student with a login removes the email',
      );
    }
    const account = await this.checkPassword(user, dto.currentPassword);
    if (!account.login) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Only a student with a login removes the email',
      );
    }
    if (!account.email) throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'No email');
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ email: null, emailVerifiedAt: null, isChildSafe: true })
        .where(eq(users.id, user.id));
      await this.audit.record(
        {
          actorId: user.id,
          entityType: 'user',
          entityId: user.id,
          action: 'account.email',
          before: { email: account.email },
          after: { email: null },
        },
        tx,
      );
    });
  }

  /** API-ME-16 (REQ-PRF-32): активные сессии — устройство из User-Agent, создана, последняя активность; IP нет. */
  async sessions(user: AuthUser): Promise<SessionItemDto[]> {
    const rows = await this.db
      .select({
        id: authSessions.id,
        userAgent: authSessions.userAgent,
        createdAt: authSessions.createdAt,
        updatedAt: authSessions.updatedAt,
      })
      .from(authSessions)
      .where(
        and(
          eq(authSessions.userId, user.id),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(authSessions.updatedAt));
    return rows
      .map((r) => ({
        id: r.id,
        device: parseUserAgent(r.userAgent),
        createdAt: r.createdAt.toISOString(),
        lastActiveAt: r.updatedAt.toISOString(),
        current: r.id === user.sessionId,
      }))
      .sort((a, b) => Number(b.current) - Number(a.current));
  }

  /** API-ME-17 (REQ-PRF-32): выйти на одном устройстве — своя сессия, кроме текущей; иначе 404. */
  async revokeSession(user: AuthUser, sessionId: string): Promise<void> {
    if (sessionId === user.sessionId) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
    }
    await this.db.transaction(async (tx) => {
      const revoked = await tx
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(authSessions.id, sessionId),
            eq(authSessions.userId, user.id),
            isNull(authSessions.revokedAt),
          ),
        )
        .returning({ id: authSessions.id });
      if (revoked.length === 0) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
      await this.audit.record(
        {
          actorId: user.id,
          entityType: 'user',
          entityId: user.id,
          action: 'account.sessions',
          after: { revoked: 1 },
        },
        tx,
      );
    });
  }

  /** API-ME-11: завершить все сессии пользователя, кроме текущей. */
  async revokeOtherSessions(user: AuthUser): Promise<void> {
    await this.db.transaction(async (tx) => {
      const revoked = await tx
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(authSessions.userId, user.id),
            isNull(authSessions.revokedAt),
            ne(authSessions.id, user.sessionId),
          ),
        )
        .returning({ id: authSessions.id });
      await this.audit.record(
        {
          actorId: user.id,
          entityType: 'user',
          entityId: user.id,
          action: 'account.sessions',
          after: { revoked: revoked.length },
        },
        tx,
      );
    });
  }

  /** Текущий пароль (BR-PRF-07): неверный — 400 invalidPassword, как в API-AUTH-05. */
  private async checkPassword(user: AuthUser, password: string) {
    const [account] = await this.db
      .select({ email: users.email, login: users.login, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, user.id));
    const ok = account?.passwordHash
      ? await verify(account.passwordHash, password).catch(() => false)
      : false;
    if (!account || !ok) {
      throw new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Current password is wrong', {
        currentPassword: 'invalidPassword',
      });
    }
    return account;
  }

  private async locale(userId: string): Promise<Locale> {
    const [prefs] = await this.db
      .select({ locale: userPreferences.locale })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    return (prefs?.locale ?? 'ru') as Locale;
  }
}
