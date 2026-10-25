import { createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte } from 'drizzle-orm';
import {
  EMAIL_TEMPLATES,
  type Locale,
  type NewDevicePayload,
  OUTBOX_EVENT_TYPES,
  parseUserAgent,
} from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { enqueueEmail } from '../../common/outbox';
import { ENV, type Env } from '../../config/env';
import { DB } from '../../infra/tokens';

const { knownDevices, users, userRoles, userPreferences } = schema;
/** BR-PRF-20: устройство считается известным, если с него входили за последние 90 дней. */
const KNOWN_FOR_MS = 90 * 86_400_000;

/** Название устройства для писем и списка сессий: «Chrome · Windows». */
export function deviceLabel(ua: string | null | undefined, unknown: string): string {
  const { browser, os } = parseUserAgent(ua);
  return [browser, os].filter(Boolean).join(' · ') || unknown;
}

/**
 * BR-PRF-20 (docs/PROFILE_TZ_2.md): письмо учителю о входе с нового устройства. Устройство — HMAC (браузер + ОС)
 * с SESSION_SECRET; сам User-Agent и IP в known_devices не хранятся. Письмо — через outbox на подтверждённый email,
 * не чаще одного на новое устройство (строка появляется сразу). Ученикам писем нет — TODO(OWNER) на будущее.
 * Ошибки здесь не мешают входу: это побочное уведомление.
 */
@Injectable()
export class KnownDevicesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  hash(ua: string | null | undefined): Buffer {
    const { browser, os } = parseUserAgent(ua);
    return createHmac('sha256', this.env.SESSION_SECRET)
      .update(`device:${browser ?? '?'}|${os ?? '?'}`)
      .digest();
  }

  /** Вход: учителю с подтверждённым email — письмо, если устройство новое. Возвращает true, если письмо поставлено. */
  async onSignIn(userId: string, userAgent: string | undefined, now = new Date()): Promise<boolean> {
    const [teacher] = await this.db
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.role, 'teacher')));
    if (!teacher) return false;
    const deviceHash = this.hash(userAgent);
    return this.db.transaction(async (tx) => {
      const [known] = await tx
        .select({ lastSeenAt: knownDevices.lastSeenAt })
        .from(knownDevices)
        .where(
          and(
            eq(knownDevices.userId, userId),
            eq(knownDevices.deviceHash, deviceHash),
            gte(knownDevices.lastSeenAt, new Date(now.getTime() - KNOWN_FOR_MS)),
          ),
        )
        .for('update');
      await tx
        .insert(knownDevices)
        .values({ userId, deviceHash, firstSeenAt: now, lastSeenAt: now })
        .onConflictDoUpdate({
          target: [knownDevices.userId, knownDevices.deviceHash],
          set: { lastSeenAt: now },
        });
      if (known) return false;
      const [account] = await tx
        .select({ email: users.email, verifiedAt: users.emailVerifiedAt, locale: userPreferences.locale })
        .from(users)
        .leftJoin(userPreferences, eq(userPreferences.userId, users.id))
        .where(eq(users.id, userId));
      if (!account?.email || !account.verifiedAt) return false;
      const locale = (account.locale ?? 'ru') as Locale;
      await enqueueEmail(tx, OUTBOX_EVENT_TYPES.emailAccount, EMAIL_TEMPLATES.newDevice, account.email, {
        locale,
        device: deviceLabel(
          userAgent,
          locale === 'en'
            ? 'Unknown device'
            : locale === 'kk'
              ? 'Белгісіз құрылғы'
              : 'Неизвестное устройство',
        ),
        at: this.formatAt(now),
      } satisfies NewDevicePayload);
      return true;
    });
  }

  /** Регистрация учителя: первое устройство известно сразу — следующий вход с него без письма. */
  async remember(userId: string, userAgent: string | undefined, now = new Date()): Promise<void> {
    await this.db
      .insert(knownDevices)
      .values({ userId, deviceHash: this.hash(userAgent), firstSeenAt: now, lastSeenAt: now })
      .onConflictDoUpdate({
        target: [knownDevices.userId, knownDevices.deviceHash],
        set: { lastSeenAt: now },
      });
  }

  /** «25.10.2026 14:32 (Алматы)» — часовой пояс платформы (PH-31/PH-42). */
  private formatAt(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.env.PLATFORM_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`;
  }
}
