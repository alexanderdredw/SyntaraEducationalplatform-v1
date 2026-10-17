'use client';

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { Progress } from 'radix-ui';
import { cn } from './cn';

/** Рамка карточки: обычная, акцентная (выделенный блок) или красная («Требуют внимания», T10). */
export type CardTone = 'default' | 'accent' | 'danger';
const cardTones: Record<CardTone, string> = {
  default: 'border-[var(--border)]',
  accent: 'border-[var(--accent)]',
  danger: 'border-[var(--danger)]',
};

/** Card (3.2): поверхность `--surface`, радиус `--radius-card`. */
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { tone?: CardTone }>(
  function Card({ className, tone = 'default', ...props }, ref) {
    return (
      <div
        ref={ref}
        data-tone={tone === 'default' ? undefined : tone}
        className={cn(
          'rounded-[var(--radius-card)] border bg-[var(--surface)] p-6 shadow-card',
          cardTones[tone],
          className,
        )}
        {...props}
      />
    );
  },
);

/** Pill (3.2): капсула-метка, например статус темы. */
export function Pill({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-pill)] border border-[var(--border)] px-3 py-1 text-xs',
        className,
      )}
      {...props}
    />
  );
}

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'danger';
const tones: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--field)] text-[var(--text-muted)]',
  accent: 'bg-[var(--accent-strong)] text-white',
  // Белый на --success даёт 3.1:1 — для текста статуса нужен тёмный (REQ-NFR-A11Y-01).
  success: 'bg-[var(--success)] text-[#070707]',
  // Белый на --danger не даёт 4,5:1 — красный текст с красной рамкой (T10 «неактивен»).
  danger: 'border border-[var(--danger)] text-[var(--danger-text)]',
};

/** Badge (3.2): небольшой статусный знак. */
export function Badge({
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      data-tone={tone}
      className={cn(
        'inline-flex items-center rounded-[var(--radius-item)] px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

/** EmptyState (3.2): пустое состояние списка; текст передаётся из i18n. */
export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center text-[var(--text-muted)]">
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      <p className="text-sm">{title}</p>
      {children}
    </div>
  );
}

/** Skeleton (3.2): плейсхолдер загрузки, скрыт от вспомогательных технологий. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-[var(--radius-item)] bg-[var(--field)]', className)}
    />
  );
}

/** Цвет полосы и значения: акцент, «слабо» (красный) и «освоено» (зелёный) — BR-AN-04, T10. */
export type ProgressTone = 'accent' | 'danger' | 'success';
const barTones: Record<ProgressTone, string> = {
  accent: 'bg-[var(--accent)]',
  danger: 'bg-[var(--danger)]',
  success: 'bg-[var(--success)]',
};
/** Текст значения рядом с полосой — контраст ≥ 4,5:1 (REQ-NFR-A11Y-01). */
export const progressTextTones: Record<ProgressTone, string> = {
  accent: 'text-[var(--accent)]',
  danger: 'text-[var(--danger-text)]',
  success: 'text-[var(--success-text)]',
};

/** ProgressBar (3.2): `value` 0–100; `label` — доступное имя из i18n. */
export function ProgressBar({
  value,
  label,
  className,
  tone = 'accent',
}: {
  value: number;
  label: string;
  className?: string;
  tone?: ProgressTone;
}) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <Progress.Root
      value={clamped}
      aria-label={label}
      className={cn(
        'relative h-2 w-full overflow-hidden rounded-[var(--radius-pill)] bg-[var(--field)]',
        className,
      )}
    >
      <Progress.Indicator
        className={cn('h-full transition-[width] duration-200 ease-[var(--ease-standard)]', barTones[tone])}
        style={{ width: `${clamped}%` }}
      />
    </Progress.Root>
  );
}
