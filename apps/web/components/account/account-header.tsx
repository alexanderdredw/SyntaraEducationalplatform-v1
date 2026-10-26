'use client';

import { type KeyboardEvent, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { formatSinceMonth, type Locale } from '@syntara/shared';
import { Avatar, avatarPresetColor, Badge, Button, cn, Skeleton } from '@syntara/ui';
import { usePathname } from '@/i18n/navigation';
import { apiRequest } from '@/lib/api/browser';
import { DASHBOARD_KEY, PROFILE_KEY } from '../learn/query-keys';
import type { components } from '@/lib/api/schema';
import { AppLink } from '../app-link';

type Profile = components['schemas']['ProfileDto'];
type Dashboard = components['schemas']['DashboardDto'];

export const ACCOUNT_TABS = [
  { key: 'overview', href: '/account' },
  { key: 'profile', href: '/account/profile' },
  { key: 'settings', href: '/account/settings' },
  { key: 'privacy', href: '/account/privacy' },
] as const;

const get =
  <T,>(path: string, locale: string) =>
  async () => {
    const res = await apiRequest<T>(path, { locale });
    if (res.kind !== 'ok') throw new Error(path);
    return res.data;
  };

/**
 * Шапка личного кабинета (REQ-PRF-20): обложка в цвете аватара, аватар 112 px (телефон — 88 px по центру), имя,
 * роль, логин или должность, «На платформе с …», «Редактировать профиль», строка цифр-ссылок и вкладки
 * «Обзор · Профиль · Настройки · Данные» (`role="tablist"`, стрелки). Одинакова на всех четырёх страницах.
 */
export function AccountHeader({ timeZone }: { timeZone: string }) {
  const t = useTranslations('account');
  const tr = useTranslations('cabinet.roles');
  const locale = useLocale();
  const profile = useQuery({ queryKey: PROFILE_KEY, queryFn: get<Profile>('/api/me/profile', locale) });
  const dashboard = useQuery({
    queryKey: DASHBOARD_KEY,
    queryFn: get<Dashboard>('/api/me/dashboard', locale),
  });
  const p = profile.data;

  const color = p
    ? p.avatar.kind === 'preset' && p.avatar.preset
      ? avatarPresetColor(p.avatar.preset)
      : p.avatar.color
    : 'slate';
  const tone = `var(--avatar-${color}, var(--avatar-slate))`;
  const name = p ? [p.firstName, p.lastName].filter(Boolean).join(' ') : '';

  return (
    <section
      aria-labelledby="account-name"
      data-testid="account-header"
      className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]"
    >
      {/* Обложка — декоративная (REQ-PRF-20.1). */}
      <div
        aria-hidden="true"
        data-testid="account-cover"
        className="h-20 sm:h-[120px]"
        style={{
          background: `linear-gradient(120deg, color-mix(in srgb, ${tone} 70%, var(--surface)), color-mix(in srgb, ${tone} 18%, var(--surface)))`,
        }}
      />
      <div className="flex flex-col gap-4 px-4 pb-4 sm:px-6">
        <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-end sm:text-left">
          <div className="-mt-11 shrink-0 rounded-full border-4 border-[var(--surface)] bg-[var(--surface)] sm:-mt-14">
            {p ? (
              <>
                <span className="sm:hidden">
                  <Avatar name={name} avatar={p.avatar} size={88} decorative />
                </span>
                <span className="hidden sm:inline-flex">
                  <Avatar name={name} avatar={p.avatar} size={112} decorative />
                </span>
              </>
            ) : (
              <Skeleton className="size-[88px] rounded-full sm:size-28" />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:pb-1">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <h2 id="account-name" className="text-xl font-bold break-words" data-testid="account-name">
                {name}
              </h2>
              {p ? <Badge tone="accent">{tr(p.role)}</Badge> : null}
            </div>
            {p ? (
              <p className="text-sm text-[var(--text-muted)] break-all">
                {p.role === 'student' ? (p.login ?? p.email) : (p.position ?? p.email)}
              </p>
            ) : null}
            {p ? (
              <p className="text-xs text-[var(--text-muted)]" data-testid="account-since">
                {/* FIX-01: «На платформе с октября 2026 г.» — общая функция packages/shared. */}
                {t('overview.since', { date: formatSinceMonth(p.createdAt, locale as Locale, timeZone) })}
              </p>
            ) : null}
          </div>
          <Button variant="secondary" asChild className="sm:mb-1">
            <AppLink href="/account/profile">{t('overview.editProfile')}</AppLink>
          </Button>
        </div>
        {dashboard.data ? <StatsRow data={dashboard.data} /> : <Skeleton className="h-14 w-full" />}
        <AccountTabs />
      </div>
    </section>
  );
}

/** REQ-PRF-20.4: строка ключевых цифр (каждая — ссылка на раздел), разделённая тонкими линиями. */
function StatsRow({ data }: { data: Dashboard }) {
  const t = useTranslations('account.header');
  const items: Array<{ key: string; value: string | number; label: string; href: string }> = data.student
    ? [
        {
          key: 'level',
          value: data.student.achievements.level,
          label: t('stats.level'),
          href: '/learn/achievements',
        },
        {
          key: 'xp',
          value: data.student.achievements.xpTotal,
          label: t('stats.xp'),
          href: '/learn/achievements',
        },
        {
          key: 'streak',
          value: data.student.achievements.streakDays,
          label: t('stats.streak'),
          href: '/learn/progress',
        },
        {
          key: 'mastered',
          value: data.student.achievements.masteredTopics,
          label: t('stats.mastered'),
          href: '/learn/progress',
        },
        {
          key: 'badges',
          value: t('stats.badgesValue', {
            earned: data.student.achievements.badgesEarned,
            total: data.student.achievements.badgesTotal,
          }),
          label: t('stats.badges'),
          href: '/learn/achievements',
        },
      ]
    : data.teacher
      ? [
          {
            key: 'classes',
            value: data.teacher.counts.classes,
            label: t('stats.classes'),
            href: '/teacher/classes',
          },
          {
            key: 'students',
            value: data.teacher.counts.students,
            label: t('stats.students'),
            href: '/teacher/classes',
          },
          {
            key: 'publishedTopics',
            value: data.teacher.counts.publishedTopics,
            label: t('stats.publishedTopics'),
            href: '/teacher/courses',
          },
          {
            key: 'battles',
            value: data.teacher.counts.battlesHosted,
            label: t('stats.battles'),
            href: '/teacher/battles?tab=history',
          },
        ]
      : [];
  return (
    <ul
      aria-label={t('statsLabel')}
      data-testid="account-stats"
      className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-field)] border border-[var(--border)] bg-[var(--border)] min-[420px]:grid-cols-3 lg:flex"
    >
      {items.map((item) => (
        <li key={item.key} className="min-w-0 flex-1 bg-[var(--surface)]">
          <AppLink
            href={item.href}
            data-testid={`account-stat-${item.key}`}
            className="flex h-full flex-col gap-0.5 px-4 py-2.5 hover:bg-[var(--field)]"
          >
            <span className="text-lg font-bold tabular-nums">{item.value}</span>
            <span className="text-xs text-[var(--text-muted)]">{item.label}</span>
          </AppLink>
        </li>
      ))}
    </ul>
  );
}

/** REQ-PRF-20.5: вкладки — `role="tablist"`, стрелки влево/вправо, Home/End; Enter — переход. */
function AccountTabs() {
  const t = useTranslations('account');
  const pathname = usePathname();
  const refs = useRef<Array<HTMLAnchorElement | null>>([]);
  const active = ACCOUNT_TABS.findIndex((tab) => tab.href === pathname);
  const onKeyDown = (e: KeyboardEvent<HTMLAnchorElement>, index: number) => {
    const last = ACCOUNT_TABS.length - 1;
    const next =
      e.key === 'ArrowRight'
        ? (index + 1) % ACCOUNT_TABS.length
        : e.key === 'ArrowLeft'
          ? (index - 1 + ACCOUNT_TABS.length) % ACCOUNT_TABS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
  };
  return (
    <nav aria-label={t('tabsLabel')}>
      <div
        role="tablist"
        aria-label={t('tabsLabel')}
        className="flex gap-1 overflow-x-auto border-b border-[var(--border)]"
      >
        {ACCOUNT_TABS.map((tab, index) => (
          <AppLink
            key={tab.key}
            ref={(el: HTMLAnchorElement | null) => {
              refs.current[index] = el;
            }}
            href={tab.href}
            role="tab"
            aria-selected={index === active}
            aria-current={index === active ? 'page' : undefined}
            tabIndex={index === active || (active < 0 && index === 0) ? 0 : -1}
            onKeyDown={(e: KeyboardEvent<HTMLAnchorElement>) => onKeyDown(e, index)}
            className={cn(
              '-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-4 text-sm',
              index === active
                ? 'border-[var(--accent-bright)] font-semibold text-[var(--text)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]',
            )}
          >
            {t(`tabs.${tab.key}`)}
          </AppLink>
        ))}
      </div>
    </nav>
  );
}
