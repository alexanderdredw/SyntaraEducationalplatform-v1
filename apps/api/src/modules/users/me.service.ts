import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  type DataRequestDto,
  getMessage,
  type Locale,
  type Messages,
  type PreferencesPatchDto,
  type UserRole,
  initialsOf,
  localDate,
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
import { VisibilityService } from '../content/visibility.service';
import { AvatarService } from '../profiles/avatar.service';
import { generatePublicNumber } from '../support/public-number';
import {
  type DataRequestItemDto,
  type DataRequestResponse,
  type MeDto,
  type MeStatsDto,
  type NotificationDto,
} from './me.dto';

const BUNDLES: Record<Locale, Messages> = { ru, kk, en };

/** Инициалы для аватара — общая функция packages/shared (5.11). */
export { initialsOf };

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
    private readonly visibility: VisibilityService,
    private readonly avatars: AvatarService,
  ) {}

  /** API-ME-01 */
  async me(user: AuthUser, preferredRole?: string): Promise<MeDto> {
    const [prefs] = await this.db
      .select()
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, user.id));
    const [account] = await this.db
      .select({
        email: schema.users.email,
        verifiedAt: schema.users.emailVerifiedAt,
        mustChange: schema.users.mustChangePassword,
      })
      .from(schema.users)
      .where(eq(schema.users.id, user.id));
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
      emailVerified: account?.email ? account.verifiedAt !== null : null,
      mustChangePassword: account?.mustChange ?? false,
      avatar: (await this.avatars.forUser(user.id))!,
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

  /** API-ME-05 GET (REQ-PRF-34): свои запросы копии и удаления данных, новые сверху (не больше 20). */
  async dataRequests(user: AuthUser): Promise<DataRequestItemDto[]> {
    const { dataSubjectRequests: dsr } = schema;
    const rows = await this.db
      .select({
        id: dsr.id,
        type: dsr.type,
        status: dsr.status,
        createdAt: dsr.createdAt,
        completedAt: dsr.completedAt,
      })
      .from(dsr)
      .where(and(eq(dsr.userId, user.id), inArray(dsr.type, ['export', 'delete'])))
      .orderBy(desc(dsr.createdAt), desc(dsr.id))
      .limit(20);
    return rows.map((r) => ({
      id: r.id,
      type: r.type as 'export' | 'delete',
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
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

  /**
   * API-S-16: серия и XP для хедера. Серия «живая» (BR-ST-03): если последний день активности раньше вчерашнего
   * (PLATFORM_TZ), серия 0. continueTopicId — последняя открытая тема, которую ученик всё ещё видит (PH-34).
   */
  async stats(user: AuthUser): Promise<MeStatsDto> {
    if (!user.roles.includes('student'))
      throw new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Forbidden');
    const [row] = await this.db
      .select({
        streak: schema.studentStats.streakCurrent,
        xpTotal: schema.studentStats.xpTotal,
        last: schema.studentStats.lastActivityDate,
      })
      .from(schema.studentStats)
      .where(eq(schema.studentStats.studentId, user.id));
    const today = localDate(new Date(), this.env.PLATFORM_TZ);
    const yesterday = localDate(new Date(Date.now() - 86_400_000), this.env.PLATFORM_TZ);
    const alive = row?.last === today || row?.last === yesterday;

    const opened = await this.db
      .selectDistinctOn([schema.learningEvents.topicId], {
        topicId: schema.learningEvents.topicId,
        at: schema.learningEvents.occurredAt,
      })
      .from(schema.learningEvents)
      .where(
        and(eq(schema.learningEvents.studentId, user.id), eq(schema.learningEvents.type, 'lesson_opened')),
      )
      .orderBy(schema.learningEvents.topicId, desc(schema.learningEvents.occurredAt));
    let continueTopicId: string | null = null;
    for (const o of opened.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 10)) {
      if (o.topicId && (await this.visibility.canStudentSeeTopic(user.id, o.topicId))) {
        continueTopicId = o.topicId;
        break;
      }
    }
    return { streakDays: alive ? (row?.streak ?? 0) : 0, xpTotal: row?.xpTotal ?? 0, continueTopicId };
  }
}
