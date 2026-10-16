'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { DropdownMenu, Popover } from 'radix-ui';
import { Bell, ChevronDown, Flame, Zap } from 'lucide-react';
import { type Locale, type UserRole } from '@syntara/shared';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@/i18n/navigation';
import { apiRequest } from '@/lib/api/browser';
import { HOME_BY_ROLE } from '@/lib/auth';
import type { components } from '@/lib/api/schema';
import { AppLink } from '../app-link';
import { DataSaverToggle, LanguageSwitcher, ThemeToggle } from '../shell/preference-controls';
import { LogoutButton } from '../staff/logout-button';

type Me = components['schemas']['MeDto'];
type Notification = components['schemas']['NotificationDto'];

const pill =
  'inline-flex min-h-[var(--control-h)] items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--border)] px-3 text-sm';
// Интерактивная капсула (роль, уведомления, профиль): hover — подложка и рамка светлее.
const pillAction = `${pill} hover:border-[var(--border-strong)] hover:bg-[var(--field)]`;

/**
 * Хедер кабинетов (REQ-GEN-SHELL-02): выбор роли, язык, трафик, тема, уведомления, профиль (буква аватара
 * и имя), «Выйти»; у ученика — серия и XP (API-S-16).
 */
export function CabinetHeader({
  me,
  role,
  stats: initialStats,
  enabledLocales,
}: {
  me: Me;
  role: UserRole;
  stats: { streakDays: number; xpTotal: number } | null;
  enabledLocales: Locale[];
}) {
  const t = useTranslations('cabinet');
  const locale = useLocale();
  const router = useRouter();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  // Серия и XP «живые»: после урока и квиза запрос ['me', 'stats'] обновляется (API-S-16).
  const statsQuery = useQuery({
    queryKey: ['me', 'stats'],
    enabled: initialStats !== null,
    initialData: initialStats ?? undefined,
    queryFn: async () => {
      const res = await apiRequest<{ streakDays: number; xpTotal: number }>('/api/me/stats', { locale });
      if (res.kind !== 'ok') throw new Error('stats');
      return res.data;
    },
  });
  const stats = initialStats ? (statsQuery.data ?? initialStats) : null;
  const notifications = useQuery({
    queryKey: ['me', 'notifications'],
    enabled: notificationsOpen,
    queryFn: async () => {
      const res = await apiRequest<Notification[]>('/api/me/notifications', { locale });
      return res.kind === 'ok' ? res.data : [];
    },
  });

  // API-ME-03: смена роли и переход на главную страницу роли.
  const switchRole = async (next: UserRole) => {
    const res = await apiRequest('/api/me/active-role', { method: 'POST', body: { role: next } });
    if (res.kind === 'ok') {
      router.push(HOME_BY_ROLE[next]);
      router.refresh();
    }
  };

  return (
    <header
      data-testid="cabinet-header"
      className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg)]/95 backdrop-blur"
    >
      <div className="mx-auto flex min-h-[var(--header-h)] flex-wrap items-center gap-2 px-4 py-2">
        <AppLink
          href="/"
          className="inline-flex min-h-11 shrink-0 items-center text-xl font-bold tracking-tight"
        >
          Syntara
        </AppLink>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {stats ? (
            <span data-testid="cabinet-stats" className={pill}>
              <Flame aria-hidden="true" className="size-4 text-[var(--warning)]" />
              <span>{t('streak', { days: stats.streakDays })}</span>
              <Zap aria-hidden="true" className="size-4 text-[var(--accent)]" />
              <span>{t('xp', { xp: stats.xpTotal })}</span>
            </span>
          ) : null}

          {me.roles.length > 1 ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                className={pillAction}
                aria-label={`${t('roleLabel')}: ${t(`roles.${role}`)}`}
              >
                <span aria-hidden="true" className="text-[var(--warning)]">
                  ◆
                </span>
                {t(`roles.${role}`)}
                <ChevronDown aria-hidden="true" className="size-4" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={6}
                  className="z-50 rounded-[var(--radius-field)] border border-[var(--border)] bg-[var(--surface)] p-1 text-[var(--text)] shadow-popover"
                >
                  {me.roles.map((r) => (
                    <DropdownMenu.Item
                      key={r}
                      onSelect={() => void switchRole(r)}
                      className="flex min-h-11 cursor-pointer items-center rounded-[var(--radius-item)] px-3 outline-none data-[highlighted]:bg-[var(--field)]"
                    >
                      {t(`roles.${r}`)}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : (
            <span className={pill} data-testid="cabinet-role">
              <span aria-hidden="true" className="text-[var(--warning)]">
                ◆
              </span>
              {t(`roles.${role}`)}
            </span>
          )}

          <LanguageSwitcher enabledLocales={enabledLocales} />
          <DataSaverToggle compact />
          <ThemeToggle />

          <Popover.Root open={notificationsOpen} onOpenChange={setNotificationsOpen}>
            <Popover.Trigger
              aria-label={t('notifications')}
              className={`${pillAction} justify-center px-0 min-w-11`}
            >
              <Bell aria-hidden="true" className="size-4" />
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="end"
                sideOffset={6}
                className="z-50 w-[min(90vw,320px)] rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text)] shadow-popover"
              >
                <h2 className="font-semibold">{t('notifications')}</h2>
                {notifications.data && notifications.data.length > 0 ? (
                  <ul className="mt-2 space-y-2">
                    {notifications.data.map((n) => (
                      <li key={n.id}>{n.type}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[var(--text-muted)]" role="status">
                    {t('noNotifications')}
                  </p>
                )}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          <AppLink
            href="/account/privacy"
            className={pillAction}
            aria-label={`${t('profile')}: ${me.displayName}`}
          >
            <span
              aria-hidden="true"
              className="inline-flex size-7 items-center justify-center rounded-full bg-[#f97316] text-xs font-bold text-white"
            >
              {me.initials.charAt(0)}
            </span>
            {/* Роль показывается один раз — в выборе роли (REQ-GEN-SHELL-02, решение владельца 2026-10-16). */}
            <span className="hidden sm:inline">{me.displayName}</span>
          </AppLink>
          <LogoutButton label={t('logout')} />
        </div>
      </div>
    </header>
  );
}
