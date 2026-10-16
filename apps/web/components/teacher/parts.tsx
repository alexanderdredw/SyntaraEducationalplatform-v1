'use client';

import { type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { type Locale, LOCALES } from '@syntara/shared';
import { cn, SegmentedControl } from '@syntara/ui';
import { AppLink } from '../app-link';

/** Ширина форм кабинета (3.1: ~664 px). */
export const CABINET_FORM_WIDTH = 'max-w-[664px]';

/** Заголовок страницы кабинета с ссылкой «назад» справа (эталоны T05, T06). */
export function PageHeader({
  title,
  back,
  children,
}: {
  title: string;
  back?: { href: string; label: string };
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
      <h1 className="text-cabinet-title font-bold">{title}</h1>
      {back ? (
        <AppLink
          href={back.href}
          className="inline-flex min-h-11 items-center text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          {back.label}
        </AppLink>
      ) : null}
      {children}
    </div>
  );
}

/**
 * Сегмент RU/KK/EN содержимого (REQ-TCH-SUBJ-01, REQ-GEN-PREF-05): не зависит от языка интерфейса;
 * заполненный язык отмечен галочкой (эталон T05).
 */
export function LanguageTabs({
  value,
  onChange,
  filled,
  label,
}: {
  value: Locale;
  onChange: (locale: Locale) => void;
  filled: Partial<Record<Locale, boolean>>;
  label: string;
}) {
  const t = useTranslations('teacher.subjectForm');
  return (
    <SegmentedControl
      label={label}
      value={value}
      onValueChange={(v) => onChange(v as Locale)}
      options={LOCALES.map((l) => ({
        value: l,
        label: l.toUpperCase(),
        adornment: filled[l] ? (
          <>
            <Check aria-hidden="true" className="ml-1 inline size-3.5" />
            <span className="sr-only"> {t('filled')}</span>
          </>
        ) : null,
      }))}
    />
  );
}

/** Статус-капсула (REQ-TCH-PUB-01, статусы файлов REQ-TCH-TOP-05). */
export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: 'neutral' | 'success' | 'danger' | 'accent';
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: 'border-[var(--border)] text-[var(--text-muted)]',
    accent: 'border-[var(--accent)] text-[var(--text)]',
    success: 'border-[var(--success)] text-[var(--text)]',
    danger: 'border-[var(--danger)] text-[var(--danger-text)]',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[var(--radius-pill)] border px-3 py-1 text-xs',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Сообщение об ошибке API: ключ fieldErrors → текст i18n `validation.*`. */
export function firstFieldError(fieldErrors: Record<string, string> | undefined): string | undefined {
  return fieldErrors ? Object.values(fieldErrors)[0] : undefined;
}

/** Ошибки Zod по путям полей: для каждого поля — первая (как в ZodValidationPipe на сервере). */
export function issuesByPath(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) out[issue.path.map(String).join('.') || '_'] ??= issue.message;
  return out;
}
