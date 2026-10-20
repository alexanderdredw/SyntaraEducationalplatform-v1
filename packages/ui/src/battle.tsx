import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { Circle, Diamond, Square, Triangle, WifiOff, X } from 'lucide-react';
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

/** Рамка цвета варианта — для приглушённой плитки. */
const answerBorderClass = (position: number) =>
  [
    'border-[var(--answer-1)]',
    'border-[var(--answer-2)]',
    'border-[var(--answer-3)]',
    'border-[var(--answer-4)]',
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
        className={cn(
          'inline-flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-item)]',
          state === 'dimmed' || state === 'wrong' ? answerToneClass(position) : 'bg-black/15',
        )}
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
  const dimmed = state === 'dimmed' || state === 'wrong';
  // Приглушённый вариант — нейтральный фон и рамка цвета варианта (не прозрачность: текст остаётся читаемым, 4,5:1).
  const className = cn(
    'flex min-h-[72px] w-full items-center gap-3 rounded-[var(--radius-control)] border-2 px-4 py-3 outline-offset-4',
    dimmed
      ? cn('bg-[var(--capsule)] text-[var(--text-muted)]', answerBorderClass(position))
      : cn('border-transparent', answerToneClass(position)),
    state === 'selected' && 'ring-4 ring-[var(--text)]',
    state === 'correct' && 'ring-4 ring-[var(--success)]',
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

/**
 * CodeInput (REQ-BTL-GEN-02, BT-S01): 6 ячеек кода Battle — автопереход, вставка из буфера, верхний регистр.
 * Первые три ячейки — буквы, последние три — цифры (BR-BTL-01); шрифт ≥ 16 px (REQ-GEN-SHELL-07).
 */
export function CodeInput({
  value,
  onChange,
  label,
  cellLabel,
  invalid,
  describedBy,
  onComplete,
  placeholder,
  large = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  /** Доступное имя ячейки: «Символ 1 из 6». */
  cellLabel: (index: number) => string;
  invalid?: boolean;
  describedBy?: string;
  onComplete?: (value: string) => void;
  /** Пример кода по ячейкам, например «KTR583» (BR-CODE-07). */
  placeholder?: string;
  large?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const chars = Array.from({ length: 6 }, (_, i) => value[i] ?? '');
  const clean = (raw: string) =>
    raw
      .replace(/\s+/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  const focus = (i: number) => refs.current[Math.max(0, Math.min(5, i))]?.focus();
  const set = (next: string, focusAt: number) => {
    const trimmed = next.slice(0, 6);
    onChange(trimmed);
    focus(focusAt);
    if (trimmed.length === 6) onComplete?.(trimmed);
  };
  return (
    <div role="group" aria-label={label} className="flex items-center gap-2">
      {chars.map((c, i) => (
        <Fragment key={i}>
          {/* BR-CODE-07: визуальный разделитель между буквами и цифрами. */}
          {i === 3 ? (
            <span aria-hidden="true" className="font-bold text-[var(--text-muted)]">
              –
            </span>
          ) : null}
          <input
            ref={(el) => {
              refs.current[i] = el;
            }}
            value={c}
            placeholder={placeholder?.[i]}
            aria-label={cellLabel(i)}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            inputMode={i < 3 ? 'text' : 'numeric'}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={6}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              const typed = clean(e.target.value);
              if (!typed) return set(value.slice(0, i) + value.slice(i + 1), i);
              set(value.slice(0, i) + typed + value.slice(i + typed.length), i + typed.length);
            }}
            onPaste={(e) => {
              e.preventDefault();
              const pasted = clean(e.clipboardData.getData('text'));
              set(value.slice(0, i) + pasted, i + pasted.length);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !c && i > 0) {
                e.preventDefault();
                set(value.slice(0, i - 1) + value.slice(i), i - 1);
              } else if (e.key === 'ArrowLeft') focus(i - 1);
              else if (e.key === 'ArrowRight') focus(i + 1);
            }}
            className={cn(
              'w-full min-w-0 rounded-[var(--radius-field)] border bg-[var(--field)] text-center font-bold uppercase text-[var(--text)] outline-none focus:border-[var(--accent)]',
              large ? 'h-16 max-w-14 text-3xl' : 'h-12 max-w-11 text-xl',
              'placeholder:text-[var(--text-muted)] placeholder:opacity-50',
              invalid ? 'border-[var(--danger)]' : 'border-[var(--border)]',
            )}
          />
        </Fragment>
      ))}
    </div>
  );
}

/** BigCode (BT-T04): крупный код для проектора с кнопкой «Копировать». */
export function BigCode({
  code,
  copyLabel,
  copiedLabel,
}: {
  code: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-center gap-4">
      <span
        data-testid="battle-code"
        className="font-mono text-6xl font-bold tracking-[0.2em] text-[var(--text)] md:text-8xl"
      >
        {code}
      </span>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(code).then(() => setCopied(true));
        }}
        className="inline-flex min-h-11 items-center rounded-[var(--radius-pill)] border border-[var(--border)] px-4 text-sm font-semibold hover:border-[var(--border-strong)] hover:bg-[var(--field)]"
      >
        <span aria-live="polite">{copied ? copiedLabel : copyLabel}</span>
      </button>
    </div>
  );
}

/**
 * CountdownBar (REQ-BTL-GEN-02): таймер вопроса по серверному дедлайну с поправкой на часы клиента
 * (`offsetMs` = serverNow − Date.now() при получении). Полоса и секунды.
 */
export function CountdownBar({
  deadlineAt,
  totalMs,
  offsetMs,
  label,
  large = false,
  onExpire,
}: {
  deadlineAt: number;
  totalMs: number;
  offsetMs: number;
  label: (seconds: number) => string;
  large?: boolean;
  onExpire?: () => void;
}) {
  const [remaining, setRemaining] = useState(() => Math.max(0, deadlineAt - (Date.now() + offsetMs)));
  const expired = useRef(false);
  useEffect(() => {
    expired.current = false;
    const tick = () => {
      const left = Math.max(0, deadlineAt - (Date.now() + offsetMs));
      setRemaining(left);
      if (left === 0 && !expired.current) {
        expired.current = true;
        onExpire?.();
      }
    };
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [deadlineAt, offsetMs, onExpire]);
  const seconds = Math.ceil(remaining / 1000);
  const percent = totalMs > 0 ? Math.min(100, (remaining / totalMs) * 100) : 0;
  return (
    <div className="flex items-center gap-3" data-testid="battle-countdown">
      <div
        role="progressbar"
        aria-label={label(seconds)}
        aria-valuemin={0}
        aria-valuemax={Math.round(totalMs / 1000)}
        aria-valuenow={seconds}
        className={cn('flex-1 overflow-hidden rounded-full bg-[var(--field)]', large ? 'h-4' : 'h-2.5')}
      >
        <div
          className={cn('h-full rounded-full', seconds <= 5 ? 'bg-[var(--danger)]' : 'bg-[var(--accent)]')}
          style={{ width: `${percent}%`, transition: 'width 200ms linear' }}
        />
      </div>
      <span
        aria-hidden="true"
        className={cn('min-w-12 text-right font-bold tabular-nums', large ? 'text-4xl' : 'text-xl')}
      >
        {seconds}
      </span>
    </div>
  );
}

export interface PodiumRow {
  rank: number;
  displayName: string;
  correctCount: number;
  correctTimeMs: number;
  me?: boolean;
}

const MEDAL = {
  1: { bg: 'bg-[var(--medal-gold)]', height: 'h-36 md:h-44' },
  2: { bg: 'bg-[var(--medal-silver)]', height: 'h-28 md:h-32' },
  3: { bg: 'bg-[var(--medal-bronze)]', height: 'h-20 md:h-24' },
} as const;

/**
 * Podium (BT-T08, BT-S06): 2-е место слева, 1-е по центру выше, 3-е справа; цвета медалей, имя, «X из Y», время.
 * Совпадающие места (BR-BTL-04) — несколько имён на одной ступени.
 */
export function Podium({
  rows,
  label,
  placeLabel,
  scoreLabel,
  meLabel,
}: {
  rows: PodiumRow[];
  label: string;
  placeLabel: (rank: number) => string;
  scoreLabel: (row: PodiumRow) => string;
  meLabel?: string;
}) {
  const steps = ([2, 1, 3] as const).map((rank) => ({ rank, rows: rows.filter((r) => r.rank === rank) }));
  return (
    <ol
      aria-label={label}
      className="flex items-end justify-center gap-2 sm:gap-4"
      data-testid="battle-podium"
    >
      {steps.map(({ rank, rows: people }) => (
        <li
          key={rank}
          className="flex min-w-0 flex-1 flex-col items-center gap-2 sm:max-w-56"
          aria-label={placeLabel(rank)}
        >
          <div className="flex w-full flex-col items-center gap-1 text-center">
            {people.length === 0 ? (
              <span className="text-sm text-[var(--text-muted)]">—</span>
            ) : (
              people.map((p) => (
                <div
                  key={`${p.displayName}-${p.correctTimeMs}`}
                  className="flex w-full flex-col items-center"
                >
                  <span
                    className={cn(
                      'max-w-full truncate font-bold sm:text-lg',
                      p.me && 'text-[var(--accent-bright)]',
                    )}
                  >
                    {p.displayName}
                    {p.me && meLabel ? <span className="sr-only"> ({meLabel})</span> : null}
                  </span>
                  <span className="text-xs text-[var(--text-muted)] sm:text-sm">{scoreLabel(p)}</span>
                </div>
              ))
            )}
          </div>
          <div
            className={cn(
              'flex w-full items-start justify-center rounded-t-[var(--radius-control)] pt-3 text-3xl font-extrabold text-[var(--medal-ink)]',
              MEDAL[rank].bg,
              MEDAL[rank].height,
            )}
            aria-hidden="true"
          >
            {rank}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** LeaderboardTable (BT-T07, BT-T08, BT-S05, BT-S06): место, имя, правильных, время; своя строка подсвечена. */
export function LeaderboardTable({
  rows,
  caption,
  columns,
  timeLabel,
  meLabel,
}: {
  rows: Array<{
    rank: number;
    displayName: string;
    correctCount: number;
    correctTimeMs?: number;
    me?: boolean;
  }>;
  caption: string;
  columns: { rank: string; name: string; correct: string; time?: string };
  timeLabel?: (ms: number) => string;
  meLabel?: string;
}) {
  return (
    // Прокручиваемая область доступна с клавиатуры (axe: scrollable-region-focusable).
    <div
      role="region"
      aria-label={caption}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)]"
    >
      <table className="w-full border-collapse text-left text-sm" data-testid="battle-leaderboard">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-[var(--capsule)] text-[var(--text-muted)]">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              {columns.rank}
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {columns.name}
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              {columns.correct}
            </th>
            {columns.time ? (
              <th scope="col" className="px-4 py-3 text-right font-medium">
                {columns.time}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={`${r.rank}-${r.displayName}-${i}`}
              aria-current={r.me ? 'true' : undefined}
              data-me={r.me ? 'true' : undefined}
              className={cn(
                'border-t border-[var(--border)]',
                r.me && 'bg-[var(--accent-soft)] font-semibold',
              )}
            >
              <td className="px-4 py-3 tabular-nums">{r.rank}</td>
              <td className="px-4 py-3 [overflow-wrap:anywhere]">
                {r.displayName}
                {r.me && meLabel ? (
                  <span className="ml-2 text-xs font-bold text-[var(--text)]">{meLabel}</span>
                ) : null}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{r.correctCount}</td>
              {columns.time ? (
                <td className="px-4 py-3 text-right tabular-nums">
                  {r.correctTimeMs !== undefined && timeLabel ? timeLabel(r.correctTimeMs) : ''}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** ParticipantChip (BT-T04): участник лобби; «×» — выгнать (подтверждение — у страницы). */
export function ParticipantChip({
  name,
  removeLabel,
  onRemove,
}: {
  name: string;
  removeLabel?: string;
  onRemove?: () => void;
}) {
  return (
    <span className="battle-chip inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--capsule)] py-1 pl-4 pr-1 text-sm font-semibold">
      <span className="max-w-48 truncate">{name}</span>
      {onRemove && removeLabel ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="inline-flex size-11 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--field)] hover:text-[var(--text)]"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      ) : (
        <span className="w-3" />
      )}
    </span>
  );
}

/** ConnectionBanner (6.9): после 3 неудачных переподключений — «Нет соединения, переподключаемся…». */
export function ConnectionBanner({ text }: { text: string }) {
  return (
    <div
      role="status"
      data-testid="battle-connection"
      className="flex items-center gap-2 rounded-[var(--radius-field)] border border-[var(--warning)] bg-[var(--capsule)] px-4 py-3 text-sm"
    >
      <WifiOff aria-hidden="true" className="size-4 text-[var(--warning)]" />
      {text}
    </div>
  );
}
