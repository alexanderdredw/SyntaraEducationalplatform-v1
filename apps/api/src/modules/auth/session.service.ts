import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { type CookieOptions, type Response } from 'express';
import { type UserRole } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ENV, type Env } from '../../config/env';
import { DB } from '../../infra/tokens';
import {
  ACTIVE_ROLE_COOKIE,
  type AuthUser,
  CSRF_COOKIE,
  ROLE_ORDER,
  SESSION_COOKIE,
  SESSION_RENEW_AFTER_MS,
  SESSION_TTL_MS,
} from './auth.types';

/**
 * Сессии (API-GEN-02, REQ-NFR-SEC-02/03): в cookie `sid` — случайный токен, в БД — только его HMAC-SHA256
 * с SESSION_SECRET. Cookie HttpOnly, Secure, SameSite=Lax; срок 14 дней, продлевается при активности.
 * CSRF — double-submit: cookie `csrf` (читается клиентом) и заголовок X-CSRF-Token.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  hashToken(token: string): Buffer {
    return createHmac('sha256', this.env.SESSION_SECRET).update(token).digest();
  }

  async create(userId: string, userAgent: string | undefined, res: Response): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.db.insert(schema.authSessions).values({
      userId,
      tokenHash: this.hashToken(token),
      expiresAt,
      userAgent: userAgent?.slice(0, 300) ?? null,
    });
    // FIX-03 (PROFILE_TZ_2): каждая новая сессия — вход (в том числе регистрация со входом) — время последнего входа.
    await this.db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, userId));
    this.setCookies(res, token, randomBytes(32).toString('base64url'));
  }

  /** Пользователь по токену сессии; продлевает срок, если с прошлого продления прошли сутки. */
  async resolve(token: string, res: Response, csrfCookie: string | undefined): Promise<AuthUser | null> {
    const { authSessions, users, userRoles } = schema;
    const [row] = await this.db
      .select({
        sessionId: authSessions.id,
        expiresAt: authSessions.expiresAt,
        userId: users.id,
        displayName: users.displayName,
      })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(
        and(
          eq(authSessions.tokenHash, this.hashToken(token)),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, new Date()),
          eq(users.status, 'active'),
        ),
      );
    if (!row) return null;

    const roles = await this.db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, row.userId));

    if (row.expiresAt.getTime() - Date.now() < SESSION_TTL_MS - SESSION_RENEW_AFTER_MS) {
      await this.db
        .update(authSessions)
        .set({ expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
        .where(eq(authSessions.id, row.sessionId));
      this.setCookies(res, token, csrfCookie ?? randomBytes(32).toString('base64url'));
    } else if (!csrfCookie) {
      res.cookie(CSRF_COOKIE, randomBytes(32).toString('base64url'), this.cookieOptions(false));
    }

    return {
      id: row.userId,
      displayName: row.displayName,
      roles: sortRoles(roles.map((r) => r.role)),
      sessionId: row.sessionId,
    };
  }

  async revoke(sessionId: string, res: Response): Promise<void> {
    await this.db
      .update(schema.authSessions)
      .set({ revokedAt: new Date() })
      .where(eq(schema.authSessions.id, sessionId));
    this.clearCookies(res);
  }

  /** Активная роль (API-ME-03; при входе через форму роли — BR-AUTH-01): cookie на срок сессии. */
  setActiveRole(res: Response, role: string): void {
    res.cookie(ACTIVE_ROLE_COOKIE, role, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_MS,
    });
  }

  clearCookies(res: Response): void {
    const { maxAge: _maxAge, ...options } = this.cookieOptions(true);
    res.clearCookie(SESSION_COOKIE, options);
    res.clearCookie(CSRF_COOKIE, { ...options, httpOnly: false });
    res.clearCookie(ACTIVE_ROLE_COOKIE, options);
  }

  /** Сравнение CSRF-токенов за постоянное время. */
  static csrfMatches(cookie: string | undefined, header: string | undefined): boolean {
    if (!cookie || !header) return false;
    const a = Buffer.from(cookie);
    const b = Buffer.from(header);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private setCookies(res: Response, token: string, csrf: string): void {
    res.cookie(SESSION_COOKIE, token, this.cookieOptions(true));
    res.cookie(CSRF_COOKIE, csrf, this.cookieOptions(false));
  }

  private cookieOptions(httpOnly: boolean): CookieOptions {
    return { httpOnly, secure: true, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_MS };
  }
}

export function sortRoles(roles: UserRole[]): UserRole[] {
  return [...new Set(roles)].sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
}
