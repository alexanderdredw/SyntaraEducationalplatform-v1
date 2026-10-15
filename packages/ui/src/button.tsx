'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from 'radix-ui';
import { cn } from './cn';

/**
 * Варианты кнопки (3.2): «Опубликовать» — светлая; ИИ — `--ai-gradient` (3.1, спецсостояния).
 * Состояния: hover и нажатие — только у доступной кнопки; focus — общий контур из tokens.css; disabled — 50 %.
 */
export type ButtonVariant = 'primary-blue' | 'primary-white' | 'secondary' | 'text' | 'publish' | 'ai';

const variants: Record<ButtonVariant, string> = {
  'primary-blue': 'bg-[var(--accent-strong)] text-white shadow-accent not-disabled:hover:brightness-110',
  'primary-white': 'bg-white text-[#070707] shadow-card not-disabled:hover:bg-white/90',
  secondary:
    'border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] not-disabled:hover:border-[var(--border-strong)] not-disabled:hover:bg-[var(--field)]',
  text: 'bg-transparent text-[var(--accent)] underline-offset-4 not-disabled:hover:underline',
  publish: 'bg-white text-[#070707] shadow-card not-disabled:hover:bg-white/90',
  ai: 'bg-[image:var(--ai-gradient)] text-white not-disabled:hover:brightness-110',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Рендерит дочерний элемент (например, ссылку) с оформлением кнопки. */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary-blue', asChild = false, className, type, ...props },
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
        'inline-flex min-h-[var(--control-h)] min-w-11 items-center justify-center gap-2 rounded-[var(--radius-pill)] px-5 text-sm font-semibold not-disabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
});
