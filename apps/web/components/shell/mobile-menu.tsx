'use client';

import { forwardRef, type ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { Menu, X } from 'lucide-react';
import { cn, HeaderBar } from '@syntara/ui';

/** Круглая кнопка меню 44 × 44 px с рамкой (UX-10). */
export const menuButtonClass =
  'inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-[var(--capsule-border)] bg-[var(--capsule)] text-[var(--text)] hover:border-[var(--border-strong)] hover:bg-[var(--field)]';

/** UX-10, п. 5: строки на всю ширину ≥ 48 px; активная — синеватый фон и рамка, полоса-индикатор слева. */
export function menuRowClass(active: boolean): string {
  return cn(
    'relative flex min-h-12 w-full items-center gap-3 rounded-[14px] border px-4 text-[17px] font-semibold',
    active
      ? 'border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent)_14%,var(--surface))] font-bold text-[var(--text)]'
      : 'border-[var(--capsule-border)] bg-[var(--capsule)] text-[color-mix(in_srgb,var(--text)_80%,transparent)] hover:border-[var(--border-strong)] hover:text-[var(--text)]',
  );
}

export function ActiveRowMark() {
  return (
    <span
      aria-hidden="true"
      className="absolute top-1/2 left-1.5 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[var(--accent-bright)]"
    />
  );
}

/** Блок меню с подписью мелким капслоком («Язык», «Настройки», «Мой кабинет»…). */
export const MenuSection = forwardRef<HTMLElement, { id: string; title: string; children: ReactNode }>(
  function MenuSection({ id, title, children }, ref) {
    return (
      <section ref={ref} aria-labelledby={id} className="flex flex-col gap-2.5 px-1">
        <h2 id={id} className="text-xs font-semibold tracking-[0.12em] text-[var(--text-muted)] uppercase">
          {title}
        </h2>
        {children}
      </section>
    );
  },
);

const HIDDEN_FROM = { md: 'md:hidden', lg: 'lg:hidden' } as const;

/**
 * Мобильное меню UX-10 (REQ-GEN-SHELL-06, REQ-NAV-07): кнопка «Меню» и панель под верхней капсулой. Закрытие —
 * кнопкой, Escape, нажатием вне панели или переходом; фокус при закрытии возвращается на «Меню» (Radix Dialog).
 */
export function MobileMenu({
  open,
  onOpenChange,
  label,
  closeLabel,
  logo,
  actions,
  hiddenFrom,
  onOpenAutoFocus,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Подпись кнопки и заголовок диалога («Меню»). */
  label: string;
  closeLabel: string;
  /** Верхняя капсула открытого меню повторяет хедер: логотип слева, кнопки справа перед «Закрыть». */
  logo: ReactNode;
  actions?: ReactNode;
  /** С какой ширины меню не показывается (публичный хедер — 1024 px, кабинет — 768 px). */
  hiddenFrom: keyof typeof HIDDEN_FROM;
  onOpenAutoFocus: (event: Event) => void;
  children: ReactNode;
}) {
  const hidden = HIDDEN_FROM[hiddenFrom];
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger aria-label={label} className={cn(menuButtonClass, hidden)}>
        <Menu aria-hidden="true" className="size-5" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={cn('mobile-menu-overlay fixed inset-0 z-40 bg-black/55', hidden)} />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={onOpenAutoFocus}
          // Обёртка «прозрачна» для нажатий (важнее встроенного стиля Radix): нажатие между капсулой и панелью
          // попадает на подложку — это нажатие вне панели (UX-10, п. 12).
          className={cn(
            'pointer-events-none! fixed inset-0 z-50 flex flex-col px-2 pt-2.5 pb-3 text-[var(--text)] sm:px-4',
            hidden,
          )}
        >
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          <HeaderBar className="pointer-events-auto">
            {logo}
            <div className="ml-auto flex items-center gap-2">
              {actions}
              <Dialog.Close aria-label={closeLabel} className={menuButtonClass}>
                <X aria-hidden="true" className="size-5" />
              </Dialog.Close>
            </div>
          </HeaderBar>
          {/* п. 10: прокручивается только панель; прокрутку страницы блокирует Radix Dialog. */}
          <div
            data-testid="mobile-menu-panel"
            className="mobile-menu-panel pointer-events-auto mx-1 mt-2 flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain rounded-[24px] border border-[var(--border)] bg-[var(--surface)] px-3 pt-2.5 pb-4 shadow-popover"
          >
            <span
              aria-hidden="true"
              className="mx-auto h-1 w-8 shrink-0 rounded-full bg-[var(--border-strong)]"
            />
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
