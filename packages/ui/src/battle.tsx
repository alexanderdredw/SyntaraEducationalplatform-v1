import { type ReactNode } from 'react';
import { Circle, Diamond, Square, Triangle } from 'lucide-react';
import { cn } from './cn';

/**
 * Battle (итерация 10.5, REQ-BTL-GEN-02): общие элементы игры. Вариант ответа всегда показывается цветом,
 * фигурой (▲ ◆ ● ■) и буквой (A–D) — не только цветом (дальтоники, экранные дикторы).
 */

const SHAPES = [Triangle, Diamond, Circle, Square] as const;
export const ANSWER_LETTERS = ['A', 'B', 'C', 'D'] as const;

/** Заливка и текст варианта по позиции 1–4 (токены --answer-N). */
export const answerToneClass = (position: number) =>
  [
    'bg-[var(--answer-1)] text-[var(--answer-1-text)]',
    'bg-[var(--answer-2)] text-[var(--answer-2-text)]',
    'bg-[var(--answer-3)] text-[var(--answer-3-text)]',
    'bg-[var(--answer-4)] text-[var(--answer-4-text)]',
  ][(position - 1) % 4]!;

/** Фигура варианта (декоративная: буква и текст передают смысл). */
export function AnswerShape({ position, className }: { position: number; className?: string }) {
  const Icon = SHAPES[(position - 1) % 4]!;
  return <Icon aria-hidden="true" fill="currentColor" strokeWidth={0} className={cn('size-4', className)} />;
}

/** Плашка «цвет + фигура + буква» — в редакторе вопроса, диаграмме раскрытия, разборе ответов. */
export function AnswerMarker({ position, className }: { position: number; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-8 min-w-12 shrink-0 items-center justify-center gap-1 rounded-[var(--radius-item)] px-2 text-sm font-bold',
        answerToneClass(position),
        className,
      )}
    >
      <AnswerShape position={position} className="size-3.5" />
      {ANSWER_LETTERS[(position - 1) % 4]}
    </span>
  );
}

/**
 * Плитка варианта ответа (BT-S03, BT-T05): большая цель нажатия (≥ 72 px), цвет + фигура + буква + текст.
 * `state`: idle — можно нажать; selected — выбранный ответ; correct / wrong — после раскрытия; dimmed — приглушён.
 */
export function AnswerTile({
  position,
  children,
  state = 'idle',
  disabled,
  onSelect,
  large = false,
  ...rest
}: {
  position: number;
  children: ReactNode;
  state?: 'idle' | 'selected' | 'correct' | 'wrong' | 'dimmed';
  disabled?: boolean;
  onSelect?: () => void;
  /** Экран ведущего / проектор: крупнее текст. */
  large?: boolean;
  'data-testid'?: string;
  'aria-label'?: string;
  'aria-pressed'?: boolean;
}) {
  const content = (
    <>
      <span
        aria-hidden="true"
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-item)] bg-black/15"
      >
        <AnswerShape position={position} className="size-5" />
      </span>
      <span className="font-bold" aria-hidden="true">
        {ANSWER_LETTERS[(position - 1) % 4]}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 text-left font-semibold [overflow-wrap:anywhere]',
          large ? 'text-2xl' : 'text-lg',
        )}
      >
        {children}
      </span>
    </>
  );
  const className = cn(
    'flex min-h-[72px] w-full items-center gap-3 rounded-[var(--radius-control)] px-4 py-3 outline-offset-4',
    answerToneClass(position),
    state === 'selected' && 'ring-4 ring-[var(--text)]',
    state === 'correct' && 'ring-4 ring-[var(--success)]',
    (state === 'dimmed' || state === 'wrong') && 'opacity-45',
  );
  if (!onSelect) {
    return (
      <div className={className} data-testid={rest['data-testid']} data-state={state}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        className,
        'enabled:hover:brightness-110 enabled:active:scale-[0.99] disabled:cursor-default',
      )}
      data-state={state}
      {...rest}
    >
      {content}
    </button>
  );
}
