'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { Button } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import { ConfirmDelete } from './confirm-delete';

/**
 * Удаление черновика (DELETE_TZ, раздел 2, API-T-30): кнопка-«корзина» в списке тем или текстовая «Удалить
 * черновик» в редакторе — только у тем, которые можно удалить (`deletable`, BR-DEL-01); перед удалением —
 * подтверждение. Отказ сервера (409 topicHasHistory / topicHasAssignments) — текстом в окне.
 */
export function DeleteTopic({
  topicId,
  title,
  variant,
  onDeleted,
}: {
  topicId: string;
  title: string;
  variant: 'icon' | 'text';
  onDeleted: () => void | Promise<void>;
}) {
  const t = useTranslations('teacher.delete');
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setPending(true);
    setError(null);
    const res = await apiRequest(`/api/teacher/topics/${topicId}`, { method: 'DELETE' });
    setPending(false);
    if (res.kind === 'ok') {
      setOpen(false);
      await onDeleted();
      return;
    }
    const key = res.kind === 'http' ? res.error.fieldErrors?.topic : undefined;
    setError(key === 'topicHasHistory' || key === 'topicHasAssignments' ? t(key) : t('failed'));
  };

  const label = t('topicAria', { title });
  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          aria-label={label}
          title={label}
          data-testid="delete-topic"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--field)] hover:text-[var(--danger-text)]"
        >
          <Trash2 aria-hidden="true" className="size-[18px]" />
        </button>
      ) : (
        <Button
          variant="danger-text"
          data-testid="delete-topic"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          {t('topicButton')}
        </Button>
      )}
      <ConfirmDelete
        open={open}
        onOpenChange={setOpen}
        title={t('topicConfirmTitle', { title })}
        text={t('topicConfirmText')}
        pending={pending}
        error={error}
        onConfirm={() => void remove()}
      />
    </>
  );
}
