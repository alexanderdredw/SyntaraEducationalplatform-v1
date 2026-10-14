import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import {
  type DataRequestDto,
  getMessage,
  type Locale,
  type Messages,
  type PreferencesPatchDto,
  type UserRole,
} from '@syntara/shared';
import ru from '@syntara/shared/i18n/ru.json';
import kk from '@syntara/shared/i18n/kk.json';
import en from '@syntara/shared/i18n/en.json';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { AppConfigService } from '../../config/app-config.service';
import { ENV, type Env } from '../../config/env';
import { DB } from '../../infra/tokens';
import { type AuthUser } from '../auth/auth.types';
import { generatePublicNumber } from '../support/public-number';
import { type DataRequestResponse, type MeDto, type MeStatsDto, type NotificationDto } from './me.dto';

const BUNDLES: Record<Locale, Messages> = { ru, kk, en };

/** Инициалы для аватара: первые буквы первых двух слов имени. */
export function initialsOf(displayName: string): string {
  return displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

/** Активная роль (API-ME-03): выбранная пользователем, если она у него есть, иначе первая по порядку 5.2. */
export function activeRoleOf(roles: UserRole[], preferred: string | undefined): UserRole {
  return roles.find((r) => r === preferred) ?? roles[0]!;
}

@Injectable()
export class MeService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: AppConfigService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** API-ME-01 */
  async me(user: AuthUser, preferredRole?: string): Promise<MeDto> {
    const [prefs] = await this.db
      .select()
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, user.id));
    return {
      id: user.id,
      displayName: user.displayName,
      initials: initialsOf(user.displayName),
      roles: user.roles,
      activeRole: activeRoleOf(user.roles, preferredRole),
      preferences: {
        locale: (prefs?.locale ?? 'ru') as Locale,
        theme: prefs?.theme ?? 'system',
        dataSaver: prefs?.dataSaver ?? false,
      },
    };
  }

  /** API-ME-02: язык, тема, экономия трафика сохраняются в user_preferences (REQ-GEN-PREF-01, -03, -04). */
  async updatePreferences(user: AuthUser, dto: PreferencesPatchDto, preferredRole?: string): Promise<MeDto> {
    const { userPreferences: p } = schema;
    await this.db
      .insert(p)
      .values({ userId: user.id, ...dto })
      .onConflictDoUpdate({ target: p.userId, set: { ...dto } });
    return this.me(user, preferredRole);
  }

  /** API-ME-04: последние уведомления (PH-32). Событий, создающих уведомления, в SPEC нет (Q-20) — список пуст. */
  async notifications(user: AuthUser): Promise<NotificationDto[]> {
    const limit = await this.config.get<number>('notifications.limit');
    const rows = await this.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, user.id))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(limit);
    return rows.map((n) => ({
      id: n.id,
      type: n.type,
      payload: n.payload as Record<string, unknown>,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    }));
  }

  /**
   * API-ME-05 (PH-08 `privacy.requests_as_tickets`): запрос копии или удаления данных — запись
   * data_subject_requests и обращение категории data_privacy в одной транзакции.
   * TODO(OWNER): аккаунты без email (ученики PH-44) — обращению нужен email для ответа; пока создаётся только запрос.
   */
  async dataRequest(user: AuthUser, dto: DataRequestDto, locale: Locale): Promise<DataRequestResponse> {
    const { users, dataSubjectRequests, supportTickets } = schema;
    const asTickets = await this.config.get<boolean>('privacy.requests_as_tickets');
    return this.db.transaction(async (tx) => {
      const [account] = await tx.select({ email: users.email }).from(users).where(eq(users.id, user.id));
      const [request] = await tx
        .insert(dataSubjectRequests)
        .values({ userId: user.id, type: dto.type })
        .returning({ id: dataSubjectRequests.id });
      let publicNumber: string | null = null;
      if (asTickets && account?.email) {
        const t = (key: string) => getMessage(BUNDLES[locale], key) ?? getMessage(BUNDLES.ru, key) ?? key;
        for (let attempt = 0; attempt < 20 && !publicNumber; attempt++) {
          const candidate = generatePublicNumber('T', new Date(), this.env.PLATFORM_TZ);
          const rows = await tx
            .insert(supportTickets)
            .values({
              publicNumber: candidate,
              category: 'data_privacy',
              subject: t(`privacy.ticket.${dto.type}`),
              name: user.displayName,
              email: account.email,
              description: t(`privacy.ticket.${dto.type}`),
              userId: user.id,
            })
            .onConflictDoNothing({ target: supportTickets.publicNumber })
            .returning({ id: supportTickets.id });
          if (rows.length) publicNumber = candidate;
        }
      }
      return { id: request!.id, type: dto.type, publicNumber };
    });
  }

  /** API-S-16: серия и XP ученика для хедера. */
  async stats(user: AuthUser): Promise<MeStatsDto> {
    if (!user.roles.includes('student'))
      throw new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Forbidden');
    const [row] = await this.db
      .select({ streakDays: schema.studentStats.streakCurrent, xpTotal: schema.studentStats.xpTotal })
      .from(schema.studentStats)
      .where(eq(schema.studentStats.studentId, user.id));
    return { streakDays: row?.streakDays ?? 0, xpTotal: row?.xpTotal ?? 0 };
  }
}
