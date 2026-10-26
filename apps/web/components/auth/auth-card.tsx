'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Eye, EyeOff } from 'lucide-react';
import { cn, fieldClass } from '@syntara/ui';
import { AppLink } from '../app-link';

/**
 * Общая карточка входа и регистрации по роли (эталон docs/media/student-auth.png): «Syntara», подпись роли, плитка с
 * иконкой, заголовок «Вход или регистрация», вкладки «Регистрация» / «Вход». Тексты — из пространства роли: ученик —
 * `studentAuth` (на «ты», REQ-GEN-AUTH-02), учитель — `teacherAuth` (на «вы», REQ-GEN-AUTH-01).
 */
export type AuthNs = 'studentAuth' | 'teacherAuth';
export type AuthTab = 'register' | 'login';

export const authInputClass = fieldClass;

const submitClass =
  'min-h-12 w-full rounded-[var(--radius-pill)] bg-[var(--accent-strong)] text-base font-semibold text-white hover:brightness-110 disabled:opacity-60';

/** Поле формы: подпись над полем, подсказка и ошибка под ним. */
export function FieldRow({
  id,
  label,
  hint,
  error,
  icon,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: ReactNode;
  /** Декоративная иконка перед подписью (BR-CODE-07: «люди» у кода класса). */
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className={cn('text-sm text-[var(--text-muted)]', icon ? 'inline-flex items-center gap-1.5' : null)}
      >
        {icon}
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-[var(--text-muted)]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-[var(--danger-text)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Пароль с кнопкой «глаз» (показать / скрыть). */
export function PasswordInput({
  ns,
  id,
  value,
  onChange,
  autoComplete,
  invalid,
  describedBy,
}: {
  ns: AuthNs;
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const t = useTranslations(ns);
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        className={cn(authInputClass, 'pr-12')}
        value={value}
        autoComplete={autoComplete}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        aria-label={visible ? t('hidePassword') : t('showPassword')}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-1 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)]"
      >
        {visible ? (
          <EyeOff aria-hidden="true" className="size-4" />
        ) : (
          <Eye aria-hidden="true" className="size-4" />
        )}
      </button>
    </div>
  );
}

/** Вкладка-форма карточки (role="tabpanel"). */
export function AuthPanel({
  prefix,
  tab,
  onSubmit,
  children,
}: {
  prefix: string;
  tab: AuthTab;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <form
      id={`${prefix}-panel-${tab}`}
      role="tabpanel"
      aria-labelledby={`${prefix}-tab-${tab}`}
      noValidate
      className="mt-5 flex flex-col gap-5"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button type="submit" disabled={pending} aria-busy={pending || undefined} className={submitClass}>
      {children}
    </button>
  );
}

/** Согласие при регистрации со ссылками «Пользовательское соглашение» и «Политика конфиденциальности». */
export function AuthConsent({ ns }: { ns: AuthNs }) {
  const t = useTranslations(ns);
  return (
    <p>
      {t.rich('consent', {
        terms: (chunks) => (
          <AppLink href="/terms" className="underline hover:text-[var(--text)]">
            {chunks}
          </AppLink>
        ),
        privacy: (chunks) => (
          <AppLink href="/privacy" className="underline hover:text-[var(--text)]">
            {chunks}
          </AppLink>
        ),
      })}
    </p>
  );
}

export function AuthCard({
  ns,
  prefix,
  icon,
  tab,
  onTab,
  notice,
  children,
  footer,
}: {
  ns: AuthNs;
  /** Префикс id вкладок и полей (`student`, `teacher`); он же — data-testid `${prefix}-auth`. */
  prefix: string;
  icon: ReactNode;
  tab: AuthTab;
  onTab: (tab: AuthTab) => void;
  /** Сообщение над вкладками (например, «Пароль изменён. Войдите с новым паролем.»). */
  notice?: string;
  /** Форма активной вкладки (AuthPanel). */
  children: ReactNode;
  /** Мелкий текст под формой. */
  footer: ReactNode;
}) {
  const t = useTranslations(ns);
  const tabButton = (value: AuthTab, label: string) => (
    <button
      type="button"
      role="tab"
      id={`${prefix}-tab-${value}`}
      aria-selected={tab === value}
      aria-controls={`${prefix}-panel-${value}`}
      onClick={() => onTab(value)}
      className={cn(
        'min-h-[var(--control-h)] flex-1 rounded-[var(--radius-field)] px-4 text-sm font-semibold',
        tab === value
          ? 'bg-[var(--accent-strong)] text-white shadow-accent'
          : 'text-[var(--text-muted)] hover:text-[var(--text)]',
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-[380px]" data-testid={`${prefix}-auth`}>
      <p className="text-center text-2xl font-bold text-[var(--accent)]">Syntara</p>
      <p className="mt-3 text-center text-xs font-semibold tracking-[0.2em] text-[var(--text-muted)]">
        {t('label')}
      </p>
      <div className="mt-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-card sm:p-6">
        <div className="flex justify-center">
          <span className="inline-flex size-14 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--field)] [&_svg]:size-6 [&_svg]:text-[var(--text)]">
            {icon}
          </span>
        </div>
        <h1 className="mt-4 text-center text-2xl font-bold">{t('title')}</h1>
        {notice ? (
          <p role="status" data-testid="login-notice" className="mt-3 text-center text-sm">
            {notice}
          </p>
        ) : null}

        <div
          role="tablist"
          aria-label={t('tabsLabel')}
          className="mt-5 flex gap-1 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--field)] p-1"
        >
          {tabButton('register', t('tabRegister'))}
          {tabButton('login', t('tabLogin'))}
        </div>

        {children}

        <div className="mt-6 flex flex-col gap-4 text-center text-xs text-[var(--text-muted)]">{footer}</div>
      </div>
    </div>
  );
}
