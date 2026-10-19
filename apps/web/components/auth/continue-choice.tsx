'use client';

import { type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight, GraduationCap, User } from 'lucide-react';
import { type Locale } from '@syntara/shared';
import { cn } from '@syntara/ui';
import { AppLink } from '../app-link';
import { LanguageSegments } from '../shell/preference-controls';

/**
 * /auth/start без роли — экран «Как продолжить?» (UX-04, docs/UX_TZ.md): ученик (главный путь) → «Вход или
 * регистрация»; учитель → регистрация и вход учителя (`?role=teacher`); «Заниматься без аккаунта» — тот же
 * гостевой режим, что «Продолжить без входа →». Карточки «Родитель» нет: роли нет в SPEC 1.3 (UX-04 ⚠).
 */
export function ContinueChoice({ enabledLocales }: { enabledLocales: readonly Locale[] }) {
  const t = useTranslations('auth.choice');
  const option = (
    role: 'student' | 'teacher',
    href: string,
    icon: ReactNode,
    title: string,
    text: string,
  ) => {
    const primary = role === 'student';
    return (
      <AppLink
        href={href}
        data-testid={`start-${role}`}
        aria-label={`${title}. ${text}`}
        className={cn(
          'flex min-h-[88px] items-center gap-4 rounded-[18px] border px-5 py-4 text-left',
          primary
            ? 'border-transparent bg-[linear-gradient(135deg,#2f7df0,#1765e8)] text-white shadow-[0_8px_28px_color-mix(in_srgb,var(--accent)_35%,transparent)] hover:brightness-110'
            : 'border-[var(--border)] bg-[var(--capsule)] hover:border-[var(--border-strong)]',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex size-14 shrink-0 items-center justify-center rounded-[14px] border [&_svg]:size-6',
            primary ? 'border-white/20 bg-white/15' : 'border-[var(--border)] bg-[var(--surface)]',
          )}
        >
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-lg font-bold">{title}</span>
          <span className={primary ? 'text-white/90' : 'text-[var(--text-muted)]'}>{text}</span>
        </span>
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex size-9 shrink-0 items-center justify-center rounded-full',
            primary ? 'bg-white/20' : 'bg-[var(--field)] text-[var(--text-muted)]',
          )}
        >
          <ChevronRight className="size-4" />
        </span>
      </AppLink>
    );
  };

  return (
    <div
      className="mx-auto flex w-full max-w-[480px] flex-col items-center gap-6"
      data-testid="continue-choice"
    >
      <AppLink href="/" className="text-3xl font-bold text-[var(--accent-bright)]">
        Syntara
      </AppLink>
      <p className="text-sm tracking-[0.12em] text-[var(--text-muted)]">{t('eyebrow')}</p>
      <div className="w-full rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-popover sm:p-9">
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <div className="mt-7 flex flex-col gap-4">
          {option('student', '/auth/start?role=student', <GraduationCap />, t('student'), t('studentText'))}
          <p className="flex items-center gap-3 text-sm text-[var(--text-muted)]">
            <span aria-hidden="true" className="h-px flex-1 bg-[var(--border)]" />
            {t('or')}
            <span aria-hidden="true" className="h-px flex-1 bg-[var(--border)]" />
          </p>
          {option('teacher', '/auth/start?role=teacher', <User />, t('teacher'), t('teacherText'))}
        </div>
        <div className="mt-7 flex flex-col items-center gap-1 text-center">
          <AppLink
            href="/"
            data-testid="choice-guest"
            className="inline-flex min-h-11 items-center gap-1 text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            {t('guest')}
            <ChevronRight aria-hidden="true" className="size-4" />
          </AppLink>
          <p className="text-xs text-[var(--text-muted)]">{t('guestNote')}</p>
        </div>
      </div>
      <LanguageSegments enabledLocales={enabledLocales} />
      <AppLink
        href="/"
        className="inline-flex min-h-11 items-center text-[var(--text-muted)] hover:text-[var(--text)]"
      >
        {t('back')}
      </AppLink>
    </div>
  );
}
