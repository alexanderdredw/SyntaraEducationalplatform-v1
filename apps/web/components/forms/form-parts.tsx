'use client';

import { forwardRef } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2 } from 'lucide-react';
import { type FieldErrors, type FieldValues } from 'react-hook-form';
import { type FormStatus, type FormSuccess } from './use-submit-form';

/** Текст ошибки поля: сообщения схем — ключи i18n `validation.*` (6.7). */
export function useErrorText() {
  const t = useTranslations('validation');
  return (message: string | undefined) => {
    if (!message) return undefined;
    return t.has(message) ? t(message) : t('required');
  };
}

/** Сводка ошибок над формой (SM-FORM): ссылки ведут к полям. */
export const ErrorSummary = forwardRef<
  HTMLDivElement,
  {
    errors: FieldErrors<FieldValues>;
    order: readonly string[];
    labels: Record<string, string>;
    ids: Record<string, string>;
  }
>(function ErrorSummary({ errors, order, labels, ids }, ref) {
  const t = useTranslations('forms');
  const errorText = useErrorText();
  const items = order.filter((name) => errors[name]);
  return (
    <div
      ref={ref}
      role="alert"
      data-testid="form-error-summary"
      className="rounded-[var(--radius-card)] border border-[var(--danger)] p-4"
    >
      <p className="font-semibold">{t('summaryTitle')}</p>
      <ul className="mt-2 list-disc pl-5 text-sm">
        {items.map((name) => (
          <li key={name}>
            <a href={`#${ids[name]}`} className="underline">
              {labels[name]}
            </a>
            {' — '}
            {errorText(errors[name]?.message as string | undefined)}
          </li>
        ))}
      </ul>
    </div>
  );
});

/** Ошибки отправки (network_error, server_error) — объявляются программам чтения с экрана. */
export function SubmitError({ status }: { status: FormStatus }) {
  const t = useTranslations('forms');
  if (status !== 'network_error' && status !== 'server_error') return null;
  return (
    <p role="alert" data-testid="form-submit-error" className="text-sm text-[var(--danger-text)]">
      {status === 'network_error' ? t('networkError') : t('serverError')}
    </p>
  );
}

/** Успех (только после 201): заголовок, номер и email (SM-FORM). */
export function SuccessNotice({ title, success }: { title: string; success: FormSuccess }) {
  const t = useTranslations('forms');
  return (
    <div
      role="status"
      data-testid="form-success"
      className="flex gap-3 rounded-[var(--radius-card)] border border-[var(--success)] p-4"
    >
      <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--success)]" />
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-sm" data-testid="form-success-number">
          {t('number', { number: success.publicNumber })}
        </p>
        <p className="text-sm text-[var(--text-muted)]" data-testid="form-success-email">
          {t('replyTo', { email: success.email })}
        </p>
      </div>
    </div>
  );
}
