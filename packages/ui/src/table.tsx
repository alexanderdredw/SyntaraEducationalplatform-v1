'use client';

import { type HTMLAttributes, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes } from 'react';
import { cn } from './cn';

/**
 * Таблица (3.2): обёртка с горизонтальной прокруткой — на узком экране прокручивается таблица, а не страница
 * (REQ-GEN-SHELL-07). Область прокрутки доступна с клавиатуры (tabIndex) и подписана (REQ-NFR-A11Y-01).
 */
export function Table({
  label,
  caption,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { label: string; caption?: ReactNode }) {
  return (
    <div
      role="region"
      aria-label={label}
      // Прокручиваемая область должна получать фокус с клавиатуры (axe scrollable-region-focusable).
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      className={cn(
        'w-full overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]',
        className,
      )}
      {...props}
    >
      <table className="w-full border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

/** Заголовок столбца или строки; `sticky` — закреплённый первый столбец при прокрутке. */
export function Th({
  className,
  sticky = false,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { sticky?: boolean }) {
  return (
    <th
      className={cn(
        'border-b border-[var(--border)] px-4 py-3 text-left font-semibold whitespace-nowrap',
        sticky && 'sticky left-0 z-10 bg-[var(--surface)]',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('border-b border-[var(--border)] px-4 py-3 whitespace-nowrap', className)} {...props} />
  );
}
