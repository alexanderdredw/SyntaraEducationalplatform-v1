'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { formatDateTime } from '@/lib/datetime';

type Result = { publicNumber: string | null };
type RequestItem = components['schemas']['DataRequestItemDto'];

/**
 * REQ-GEN-AUTH-04: «Запросить копию» и «Запросить удаление» → API-ME-05 (обращение data_privacy, PH-08).
 * REQ-PRF-34: под кнопками — свои запросы с датой и статусом. Готовность копии сейчас не отслеживается, поэтому
 * у копии — «Запрос принят {дата}».
 * TODO(OWNER): статусы «Копия данных готовится» и «Готово — скачать (ссылка действует 7 дней)» — когда появится
 * выгрузка копии с отслеживанием готовности.
 */
export function PrivacyRequests({ timeZone }: { timeZone: string }) {
  const t = useTranslations('privacy');
  const tf = useTranslations('forms');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const requests = useQuery({
    queryKey: ['me', 'data-requests'],
    queryFn: async () => {
      const res = await apiRequest<RequestItem[]>('/api/me/data-requests', { locale });
      if (res.kind !== 'ok') throw new Error('data-requests');
      return res.data;
    },
  });

  const request = async (type: 'export' | 'delete') => {
    setPending(true);
    setFailed(false);
    const res = await apiRequest<Result>('/api/me/data-requests', { method: 'POST', locale, body: { type } });
    setPending(false);
    if (res.kind === 'ok') {
      setMessage(res.data.publicNumber ? t('sent', { number: res.data.publicNumber }) : t('sentNoNumber'));
      await queryClient.invalidateQueries({ queryKey: ['me', 'data-requests'] });
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
      {requests.data?.length ? (
        <section aria-labelledby="privacy-requests-title" className="flex flex-col gap-2">
          <h2 id="privacy-requests-title" className="text-cabinet-block font-semibold">
            {t('requests.title')}
          </h2>
          <ul
            className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-card)] border border-[var(--border)]"
            data-testid="privacy-requests"
          >
            {requests.data.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-0.5 px-4 py-3"
                data-testid="privacy-request"
                data-type={r.type}
              >
                <span className="text-sm font-medium">{t(`requests.${r.type}`)}</span>
                <span className="text-sm text-[var(--text-muted)]">
                  {r.type === 'delete'
                    ? `${formatDateTime(r.createdAt, timeZone)} · ${t('requests.deleteSent')}`
                    : t('requests.accepted', { date: formatDateTime(r.createdAt, timeZone) })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
