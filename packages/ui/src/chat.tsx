'use client';

import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

/**
 * Чат с ИИ (3.2; эталоны U02, U06–U07): лента, сообщение с аватаром и подписью, статус «Онлайн».
 * Оформление — только здесь и в tokens.css, чтобы дизайн чатов менялся в одном месте (итерация 8.5).
 */
export function ChatLog({ className, ...props }: HTMLAttributes<HTMLOListElement>) {
  return <ol className={cn('flex flex-col gap-4', className)} {...props} />;
}

export function ChatMessage({
  from,
  author,
  note,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLLIElement> & {
  /** Чьё сообщение: ученика (справа) или ИИ (слева). */
  from: 'user' | 'assistant';
  /** Подпись автора: «Вы» / «Syntara» (REQ-ST-AI-02); первая буква — аватар. */
  author: string;
  /** Пометка под текстом, например «Ответ прерван». */
  note?: ReactNode;
}) {
  const mine = from === 'user';
  return (
    <li
      data-from={from}
      className={cn('flex items-start gap-3', mine ? 'flex-row-reverse' : 'flex-row', className)}
      {...props}
    >
      <ChatAvatar letter={author.slice(0, 1)} accent={mine} />
      <div
        className={cn(
          'flex max-w-[min(85%,464px)] flex-col gap-1 rounded-[var(--radius-field)] px-4 py-3 text-sm leading-relaxed',
          mine
            ? 'items-end bg-[var(--accent-strong)] text-white'
            : 'bg-[var(--chat-bubble)] text-[var(--text)]',
        )}
      >
        <span className={cn('text-[11px]', mine ? 'text-white' : 'text-[var(--text-muted)]')}>{author}</span>
        <div className="flex flex-col gap-2 break-words">{children}</div>
        {note ? <p className="text-xs text-[var(--text-muted)]">{note}</p> : null}
      </div>
    </li>
  );
}

export function ChatAvatar({
  letter,
  accent = false,
  size = 'md',
}: {
  letter: string;
  accent?: boolean;
  /** `lg` — аватар в шапке страницы помощника (U02). */
  size?: 'md' | 'lg';
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[var(--radius-pill)] font-semibold uppercase',
        size === 'lg' ? 'size-10 text-base' : 'size-7 text-xs',
        accent ? 'bg-[var(--accent-strong)] text-white' : 'border border-[var(--border)] bg-[var(--field)]',
      )}
    >
      {letter}
    </span>
  );
}

/** Статус собеседника, например «Онлайн» (U02): точка `--success` и текст `--success-text`. */
export function StatusDot({ children, className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('inline-flex items-center gap-2 text-sm text-[var(--success-text)]', className)}
      {...props}
    >
      <span aria-hidden="true" className="size-2 rounded-[var(--radius-pill)] bg-[var(--success)]" />
      {children}
    </span>
  );
}

/**
 * Карточка чата (U02, U06–U07): тёмно-синий фон `--chat-surface`; `inset` — без внутренних отступов
 * (страница помощника с зонами шапки, ленты и поля).
 */
export function ChatCard({
  className,
  inset = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { inset?: boolean }) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-[var(--radius-card)] border border-[var(--chat-panel-border)] bg-[image:var(--chat-surface)]',
        inset ? 'overflow-hidden' : 'gap-4 p-4',
        className,
      )}
      {...props}
    />
  );
}

/** Панель ленты сообщений внутри карточки чата (U06–U07). */
export function ChatPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[14px] border border-[var(--chat-panel-border)] bg-[var(--chat-panel)] p-4',
        className,
      )}
      {...props}
    />
  );
}
