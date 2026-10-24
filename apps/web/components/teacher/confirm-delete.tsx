'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Modal } from '@syntara/ui';

/**
 * Подтверждение удаления (DELETE_TZ, разделы 2–3): заголовок-вопрос, пояснение, «Удалить» (красная) и «Отмена».
 * Фокус по умолчанию — на «Отмена»: случайный Enter ничего не удаляет. Ошибка API показывается внутри окна.
 */
export function ConfirmDelete({
  open,
  onOpenChange,
  title,
  text,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  text?: string;
  pending: boolean;
  error?: string | null;
  onConfirm: () => void;
}) {
  const t = useTranslations('teacher.delete');
  const tc = useTranslations('common');
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={text}
      closeLabel={tc('close')}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        cancel.current?.focus();
      }}
    >
      <div className="flex flex-col gap-3" data-testid="confirm-delete">
        {error ? (
          <p role="alert" className="text-sm text-[var(--danger-text)]">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-3">
          <Button ref={cancel} variant="secondary" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button variant="danger" disabled={pending} aria-busy={pending} onClick={onConfirm}>
            {t('confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
