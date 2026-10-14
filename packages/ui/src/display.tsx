'use client';

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { Progress } from 'radix-ui';
import { cn } from './cn';

/** Card (3.2): поверхность `--surface`, радиус `--radius-card`. */
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Card(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-6',
        className,
      )}
      {...props}
    />
  );
});

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
  danger: 'bg-[var(--danger)] text-white',
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
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
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
  return <div aria-hidden="true" className={cn('animate-pulse rounded-lg bg-[var(--field)]', className)} />;
}

/** ProgressBar (3.2): `value` 0–100; `label` — доступное имя из i18n. */
export function ProgressBar({
  value,
  label,
  className,
}: {
  value: number;
  label: string;
  className?: string;
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
        className="h-full bg-[var(--accent)] transition-[width]"
        style={{ width: `${clamped}%` }}
      />
    </Progress.Root>
  );
}
