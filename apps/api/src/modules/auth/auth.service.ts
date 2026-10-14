import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';
import { eq } from 'drizzle-orm';
import { type Response } from 'express';
import { type LoginDto } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { DB } from '../../infra/tokens';
import { type MeDto } from '../users/me.dto';
import { MeService } from '../users/me.service';
import { SessionService, sortRoles } from './session.service';

/** Пароли — Argon2id (REQ-NFR-SEC-02). */
export const hashPassword = (password: string) => hash(password, { type: argon2id });

@Injectable()
export class AuthService {
  /** Хеш-заглушка: проверка занимает одинаковое время, есть пользователь или нет. */
  private dummyHash?: Promise<string>;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly sessions: SessionService,
    private readonly me: MeService,
  ) {}

  /** API-AUTH-01. Ошибка одна и та же для неизвестного email и неверного пароля. */
  async login(
    dto: LoginDto,
    userAgent: string | undefined,
    res: Response,
    previousSessionId?: string,
  ): Promise<MeDto> {
    const { users, userRoles } = schema;
    const [user] = await this.db
      .select({
        id: users.id,
        displayName: users.displayName,
        passwordHash: users.passwordHash,
        status: users.status,
      })
      .from(users)
      .where(eq(users.email, dto.email));

    this.dummyHash ??= hashPassword('timing-equalizer');
    const stored = user?.passwordHash ?? (await this.dummyHash);
    const valid = await verify(stored, dto.password).catch(() => false);
    if (!user || !user.passwordHash || !valid || user.status !== 'active') {
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', 'Invalid email or password');
    }

    const roles = await this.db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, user.id));
    if (roles.length === 0) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', 'Invalid email or password');
    }

    // Новая сессия при каждом входе; прежняя (если была в этом браузере) отзывается.
    if (previousSessionId) await this.sessions.revoke(previousSessionId, res);
    await this.sessions.create(user.id, userAgent, res);
    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    return this.me.me({
      id: user.id,
      displayName: user.displayName,
      roles: sortRoles(roles.map((r) => r.role)),
      sessionId: '',
    });
  }
}
