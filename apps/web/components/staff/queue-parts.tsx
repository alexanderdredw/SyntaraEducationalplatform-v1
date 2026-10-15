'use client';

import { type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, type BadgeTone, Card, cn } from '@syntara/ui';
import { formatDateTime } from '@/lib/datetime';
import { type ActionProblem } from './staff-api';

export function DateTime({ iso, timeZone }: { iso: string; timeZone: string }) {
  return <time dateTime={iso}>{formatDateTime(iso, timeZone)}</time>;
}

const STATUS_TONE: Record<string, BadgeTone> = {
  new: 'accent',
  reopened: 'accent',
  resolved: 'success',
  onboarded: 'success',
  closed: 'neutral',
  rejected: 'danger',
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? 'neutral'} data-status={status}>
      {label}
    </Badge>
  );
}

export function Panel({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <Card className="p-4 md:p-5" data-testid={testId}>
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="mt-3">{children}</div>
    </Card>
  );
}

/** Пары «подпись — значение» (карточка обращения или заявки). */
export function Details({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-[var(--text-muted)]">{label}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ActionFeedback({ problem, done }: { problem: ActionProblem; done: boolean }) {
  const t = useTranslations('staff.actions');
  if (problem) {
    return (
      <p role="alert" data-testid="staff-action-error" className="text-sm text-[var(--danger-text)]">
        {problem === 'invalidTransition' ? t('invalidTransition') : t('error')}
      </p>
    );
  }
  return (
    <p role="status" className={cn('text-sm', !done && 'sr-only')}>
      {done ? t('done') : ''}
    </p>
  );
}

/** Нативный select фильтра: с клавиатуры и в программах чтения с экрана работает без доработок. */
export function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex min-w-40 flex-col gap-1">
      <label htmlFor={id} className="text-xs text-[var(--text-muted)]">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 rounded-[var(--radius-field)] border border-[var(--border)] bg-[var(--field)] px-3 text-base hover:border-[var(--border-strong)] text-[var(--text)]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
