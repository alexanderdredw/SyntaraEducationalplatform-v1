'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from 'radix-ui';
import { cn } from './cn';

/**
 * Варианты кнопки (3.2): «Опубликовать» — светлая; ИИ — `--ai-gradient` (3.1, спецсостояния).
 * Состояния: hover и нажатие — только у доступной кнопки; focus — общий контур из tokens.css; disabled — 50 %.
 */
export type ButtonVariant =
  'primary-blue' | 'primary-white' | 'secondary' | 'text' | 'quiet' | 'publish' | 'ai';

const variants: Record<ButtonVariant, string> = {
  'primary-blue': 'bg-[var(--accent-strong)] text-white not-disabled:hover:brightness-110',
  'primary-white': 'bg-white text-[#070707] shadow-card not-disabled:hover:bg-white/90',
  secondary:
    'border border-[var(--border)] bg-transparent text-[var(--text)] not-disabled:hover:border-[var(--border-strong)] not-disabled:hover:bg-[var(--field)]',
  text: 'bg-transparent text-[var(--accent)] underline-offset-4 not-disabled:hover:underline',
  // Приглушённая текстовая кнопка («Выйти» в хедере, «История версий» — эталоны U01–T10, T07).
  quiet: 'bg-transparent text-[var(--text-muted)] not-disabled:hover:text-[var(--text)]',
  publish: 'bg-white text-[#070707] shadow-card not-disabled:hover:bg-white/90',
  ai: 'bg-[image:var(--ai-gradient)] text-white not-disabled:hover:brightness-110',
};

/**
 * Размер: `md` — 44 px; `sm` — компактная капсула 32 px, как на эталонах кабинета («Выдать классу», «Leave»),
 * с невидимой зоной нажатия 44 px (REQ-GEN-SHELL-07, docs/UX_AI_TZ.md п. 5.8).
 */
export type ButtonSize = 'md' | 'sm';
const sizes: Record<ButtonSize, string> = {
  md: 'min-h-[var(--control-h)] min-w-11 px-5 text-sm',
  sm: "relative min-h-8 px-3 text-xs after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Форма: капсула (по умолчанию) или скруглённый прямоугольник — «Спросить» в чате (эталоны U02, U06). */
  shape?: 'pill' | 'rounded';
  /** Рендерит дочерний элемент (например, ссылку) с оформлением кнопки. */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary-blue', size = 'md', shape = 'pill', asChild = false, className, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? 'button')}
      data-variant={variant}
      className={cn(
        // зона нажатия ≥ 44×44 (REQ-GEN-SHELL-07)
        'inline-flex items-center justify-center gap-2 font-medium not-disabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
        shape === 'pill' ? 'rounded-[var(--radius-pill)]' : 'rounded-[var(--radius-field)]',
        sizes[size],
        variants[variant],
        className,
      )}
      {...props}
    />
  );
});
