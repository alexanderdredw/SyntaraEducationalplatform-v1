import { type RequestStatus, type TicketStatus } from './enums';

/**
 * SM-TICKET (раздел 9). Кто инициирует событие:
 * staff — сотрудник (API-SUP-03, API-SUP-06), user — ответ пользователя на письмо (API-SUP-08),
 * system — задача worker (BR-SUP-02).
 */
export type TicketActor = 'staff' | 'user' | 'system';
export type TicketEvent =
  'assign' | 'ask_user' | 'user_reply' | 'escalate' | 'resume' | 'resolve' | 'auto_close';

export interface TicketTransition {
  event: TicketEvent;
  from: readonly TicketStatus[];
  to: TicketStatus;
  actor: TicketActor;
}

export const TICKET_TRANSITIONS: readonly TicketTransition[] = [
  { event: 'assign', from: ['new', 'reopened'], to: 'in_progress', actor: 'staff' },
  { event: 'ask_user', from: ['in_progress'], to: 'waiting_user', actor: 'staff' },
  { event: 'user_reply', from: ['waiting_user'], to: 'in_progress', actor: 'user' },
  { event: 'escalate', from: ['in_progress'], to: 'waiting_internal', actor: 'staff' },
  { event: 'resume', from: ['waiting_internal'], to: 'in_progress', actor: 'staff' },
  {
    event: 'resolve',
    from: ['in_progress', 'waiting_user', 'waiting_internal'],
    to: 'resolved',
    actor: 'staff',
  },
  { event: 'auto_close', from: ['resolved'], to: 'closed', actor: 'system' },
  { event: 'user_reply', from: ['resolved', 'closed'], to: 'reopened', actor: 'user' },
];

/** Переход по событию; `null` — событие из этого статуса недопустимо (→ 409 INVALID_TRANSITION). */
export function ticketTransition(from: TicketStatus, event: TicketEvent): TicketStatus | null {
  return TICKET_TRANSITIONS.find((t) => t.event === event && t.from.includes(from))?.to ?? null;
}

/**
 * Статусы, в которые сотрудник может перевести обращение через API-SUP-06.
 * Назначение (new/reopened → in_progress) выполняется только через API-SUP-03, закрытие — только worker,
 * reopened и возврат из waiting_user — только ответом пользователя.
 */
export const STAFF_STATUS_EVENTS: readonly TicketEvent[] = ['ask_user', 'escalate', 'resume', 'resolve'];

export function staffStatusTargets(from: TicketStatus): TicketStatus[] {
  return TICKET_TRANSITIONS.filter(
    (t) => t.actor === 'staff' && STAFF_STATUS_EVENTS.includes(t.event) && t.from.includes(from),
  ).map((t) => t.to);
}

/** SM-REQUEST (раздел 9): new → in_progress → contacted → onboarded | rejected. */
export const REQUEST_TRANSITIONS: Readonly<Record<RequestStatus, readonly RequestStatus[]>> = {
  new: ['in_progress'],
  in_progress: ['contacted'],
  contacted: ['onboarded', 'rejected'],
  onboarded: [],
  rejected: [],
};

export function canTransitionRequest(from: RequestStatus, to: RequestStatus): boolean {
  return REQUEST_TRANSITIONS[from].includes(to);
}

/** PH-22 `support.hours`. */
export interface SupportHours {
  days: string;
  from: string;
  to: string;
  tz: string;
  first_response_business_days: number;
}

const ISO_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** Рабочие дни ISO (1 = пн … 7 = вс) из строки вида «mon-fri» или «mon,wed,fri». */
export function workingIsoDays(days: string): Set<number> {
  const result = new Set<number>();
  for (const part of days.toLowerCase().split(',')) {
    const [a, b] = part.trim().split('-');
    const start = ISO_DAYS.indexOf(a as (typeof ISO_DAYS)[number]);
    const end = b === undefined ? start : ISO_DAYS.indexOf(b as (typeof ISO_DAYS)[number]);
    if (start < 0 || end < 0) continue;
    for (let i = start; ; i = (i + 1) % 7) {
      result.add(i + 1);
      if (i === end) break;
    }
  }
  return result;
}

/**
 * Сдвиг в календарных днях до срока первого ответа для каждого дня недели создания (1..7):
 * отсчитываются `businessDays` рабочих дней, время суток сохраняется.
 * Один и тот же расчёт используется в SQL-фильтре `dueBefore` (API-SUP-01) и при показе срока.
 * Часы работы (from/to) на срок не влияют — TODO(OWNER): учитывать ли время суток в цели первого ответа (PH-22)?
 */
export function dueOffsetDays(days: string, businessDays: number): Record<number, number> {
  const working = workingIsoDays(days);
  const offsets: Record<number, number> = {};
  for (let dow = 1; dow <= 7; dow++) {
    let offset = 0;
    let counted = 0;
    let current = dow;
    while (counted < businessDays && working.size > 0) {
      offset += 1;
      current = (current % 7) + 1;
      if (working.has(current)) counted += 1;
    }
    offsets[dow] = offset;
  }
  return offsets;
}

/** ISO-день недели (1 = пн) момента `date` в часовом поясе `timeZone`. */
export function isoWeekday(date: Date, timeZone: string): number {
  const short = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date).toLowerCase();
  return ISO_DAYS.indexOf(short.slice(0, 3) as (typeof ISO_DAYS)[number]) + 1;
}

/** Срок первого ответа (REQ-SUP-04, PH-22) — только для служебной очереди, пользователю не показывается. */
export function firstResponseDueAt(createdAt: Date, hours: SupportHours, timeZone: string): Date {
  const offset =
    dueOffsetDays(hours.days, hours.first_response_business_days)[isoWeekday(createdAt, timeZone)] ?? 0;
  return new Date(createdAt.getTime() + offset * 24 * 60 * 60 * 1000);
}
