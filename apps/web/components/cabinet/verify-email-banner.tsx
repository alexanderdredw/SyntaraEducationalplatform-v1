'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { MailWarning } from 'lucide-react';
import { Button } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';

/**
 * Напоминание учителю «Подтвердите email» (решение владельца 2026-10-14): вход до подтверждения разрешён;
 * повторная отправка ссылки — API-AUTH-06.
 */
export function VerifyEmailBanner() {
  const t = useTranslations('cabinet.verify');
  const tf = useTranslations('forms');
  const locale = useLocale();
  const [state, setState] = useState<'idle' | 'sent' | 'error'>('idle');
  const [pending, setPending] = useState(false);
  return (
    <div
      data-testid="verify-email-banner"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--field)] px-4 py-3 text-sm"
    >
      <span className="flex items-center gap-2">
        <MailWarning aria-hidden="true" className="size-4 text-[var(--warning)]" />
        {t('text')}
      </span>
      <span className="flex items-center gap-3">
        <span role="status">
          {state === 'sent' ? t('resent') : state === 'error' ? tf('serverError') : ''}
        </span>
        <Button
          variant="secondary"
          disabled={pending || state === 'sent'}
          onClick={async () => {
            setPending(true);
            const res = await apiRequest('/api/auth/email/resend', { method: 'POST', locale });
            setPending(false);
            setState(res.kind === 'ok' ? 'sent' : 'error');
          }}
        >
          {t('resend')}
        </Button>
      </span>
    </div>
  );
}
