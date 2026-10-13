'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from 'radix-ui';
import { cn } from './cn';

/** Варианты кнопки (3.2): «Опубликовать» — светлая; ИИ — `--ai-gradient` (3.1, спецсостояния). */
export type ButtonVariant = 'primary-blue' | 'primary-white' | 'secondary' | 'text' | 'publish' | 'ai';

const variants: Record<ButtonVariant, string> = {
  'primary-blue': 'bg-[var(--accent)] text-white hover:brightness-110',
  'primary-white': 'bg-white text-[#070707] hover:bg-white/90',
  secondary: 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--field)]',
  text: 'bg-transparent text-[var(--accent)] hover:underline',
  publish: 'bg-white text-[#070707] hover:bg-white/90',
  ai: 'bg-[image:var(--ai-gradient)] text-white hover:brightness-110',
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
        'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-[var(--radius-pill)] px-5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
});
