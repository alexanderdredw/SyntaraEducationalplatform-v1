'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';

type Result = { publicNumber: string | null };

/** REQ-GEN-AUTH-04: «Запросить копию» и «Запросить удаление» → API-ME-05 (обращение data_privacy, PH-08). */
export function PrivacyRequests() {
  const t = useTranslations('privacy');
  const tf = useTranslations('forms');
  const locale = useLocale();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);

  const request = async (type: 'export' | 'delete') => {
    setPending(true);
    setFailed(false);
    const res = await apiRequest<Result>('/api/me/data-requests', { method: 'POST', locale, body: { type } });
    setPending(false);
    if (res.kind === 'ok') {
      setMessage(res.data.publicNumber ? t('sent', { number: res.data.publicNumber }) : t('sentNoNumber'));
    } else setFailed(true);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => void request('export')} disabled={pending}>
          {t('requestCopy')}
        </Button>
        <Button variant="secondary" onClick={() => void request('delete')} disabled={pending}>
          {t('requestDelete')}
        </Button>
      </div>
      <p role="status" data-testid="privacy-result">
        {message ?? ''}
      </p>
      {failed ? (
        <p role="alert" className="text-sm text-[var(--danger-text)]">
          {tf('serverError')}
        </p>
      ) : null}
    </div>
  );
}
