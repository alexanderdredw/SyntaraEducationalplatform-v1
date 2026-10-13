'use client';

import { type ReactNode } from 'react';
import { Dialog, Toast as ToastPrimitive } from 'radix-ui';
import { X } from 'lucide-react';

/**
 * Modal (3.2) на Radix Dialog: фокус внутри окна, Escape закрывает, фокус возвращается на кнопку-триггер.
 * `closeLabel` — доступное имя кнопки закрытия из i18n.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  trigger,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description?: string;
  closeLabel: string;
  trigger?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text)]"
        >
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
            <Dialog.Close
              className="flex size-11 items-center justify-center rounded-full"
              aria-label={closeLabel}
            >
              <X aria-hidden="true" className="size-5" />
            </Dialog.Close>
          </div>
          {description ? (
            <Dialog.Description className="mt-2 text-sm text-[var(--text-muted)]">
              {description}
            </Dialog.Description>
          ) : null}
          <div className="mt-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Toast (3.2): провайдер + область уведомлений; сообщения объявляются через aria-live (Radix). */
export function ToastProvider({ children, regionLabel }: { children: ReactNode; regionLabel: string }) {
  return (
    <ToastPrimitive.Provider label={regionLabel}>
      {children}
      <ToastPrimitive.Viewport className="fixed bottom-24 left-1/2 z-50 flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2" />
    </ToastPrimitive.Provider>
  );
}

export function Toast({
  open,
  onOpenChange,
  title,
  tone = 'neutral',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  tone?: 'neutral' | 'success' | 'danger';
}) {
  const border =
    tone === 'success'
      ? 'border-[var(--success)]'
      : tone === 'danger'
        ? 'border-[var(--danger)]'
        : 'border-[var(--border)]';
  return (
    <ToastPrimitive.Root
      open={open}
      onOpenChange={onOpenChange}
      className={`rounded-xl border ${border} bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)]`}
    >
      <ToastPrimitive.Title>{title}</ToastPrimitive.Title>
    </ToastPrimitive.Root>
  );
}
