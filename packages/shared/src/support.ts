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

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** «09:00» → минуты от полуночи. */
function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Смещение «UTC+5», «UTC-03:30» в минутах; null — не фиксированное смещение. */
export function parseUtcOffset(tz: string): number | null {
  const match = /^UTC([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(tz.trim());
  if (!match) return tz.trim().toUpperCase() === 'UTC' ? 0 : null;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === '-' ? -minutes : minutes;
}

/** Смещение IANA-пояса в минутах на момент `date`. */
function zoneOffset(date: Date, timeZone: string): number {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  return parseUtcOffset(name.replace('GMT', 'UTC')) ?? 0;
}

/**
 * Рабочее время PH-22 («mon-fri», 09:00–18:00, «UTC+5»). Расчёт ведётся в «локальных» миллисекундах
 * (UTC + смещение пояса). Рабочие моменты — отрезок [from, to] каждого рабочего дня.
 */
class WorkingTime {
  private readonly days: Set<number>;
  private readonly from: number;
  private readonly to: number;
  readonly offsetMs: number;

  constructor(hours: SupportHours, fallbackTimeZone: string, at: Date) {
    this.days = workingIsoDays(hours.days);
    this.from = minutesOf(hours.from) * MINUTE;
    this.to = minutesOf(hours.to) * MINUTE;
    this.offsetMs = (parseUtcOffset(hours.tz) ?? zoneOffset(at, fallbackTimeZone)) * MINUTE;
  }

  /** Длительность рабочего дня в мс. */
  get dayLength(): number {
    return Math.max(0, this.to - this.from);
  }

  private isWorking(dayStart: number): boolean {
    // 1970-01-01 — четверг (ISO 4).
    const iso = ((Math.floor(dayStart / DAY) + 3) % 7) + 1;
    return this.days.has(iso);
  }

  private get usable(): boolean {
    return this.days.size > 0 && this.dayLength > 0;
  }

  /** Ближайший рабочий момент не раньше `t`. */
  forward(t: number): number {
    if (!this.usable) return t;
    for (;;) {
      const d = Math.floor(t / DAY) * DAY;
      if (this.isWorking(d)) {
        if (t < d + this.from) return d + this.from;
        if (t <= d + this.to) return t;
      }
      t = d + DAY;
    }
  }

  /** Ближайший рабочий момент не позже `t`. */
  backward(t: number): number {
    if (!this.usable) return t;
    for (;;) {
      const d = Math.floor(t / DAY) * DAY;
      if (this.isWorking(d)) {
        if (t > d + this.to) return d + this.to;
        if (t >= d + this.from) return t;
      }
      t = d - 1;
    }
  }

  /** Прибавить рабочее время к рабочему моменту. */
  add(t: number, ms: number): number {
    if (!this.usable) return t + ms;
    for (;;) {
      const d = Math.floor(t / DAY) * DAY;
      const available = d + this.to - t;
      if (ms <= available) return t + ms;
      ms -= available;
      t = this.forward(d + DAY);
    }
  }

  /** Вычесть рабочее время из рабочего момента. */
  sub(t: number, ms: number): number {
    if (!this.usable) return t - ms;
    for (;;) {
      const d = Math.floor(t / DAY) * DAY;
      const available = t - (d + this.from);
      if (ms <= available) return t - ms;
      ms -= available;
      t = this.backward(d - 1);
    }
  }
}

/**
 * Срок первого ответа (REQ-SUP-04, PH-22; решение владельца 2026-10-14): `first_response_business_days`
 * рабочих дней рабочего времени, отсчитанных от ближайшего рабочего момента после создания.
 * Например, при пн–пт 09:00–18:00: пн 10:00 → вт 10:00; пт 17:00 → пн 17:00; сб → пн 18:00.
 * Только для служебной очереди, пользователю не показывается.
 */
export function firstResponseDueAt(createdAt: Date, hours: SupportHours, timeZone: string): Date {
  const w = new WorkingTime(hours, timeZone, createdAt);
  const local = createdAt.getTime() + w.offsetMs;
  const due = w.add(w.forward(local), hours.first_response_business_days * w.dayLength);
  return new Date(due - w.offsetMs);
}

/**
 * Обратная функция для фильтра «срок до» (API-SUP-01): срок монотонно не убывает со временем создания,
 * поэтому `firstResponseDueAt(c) <= dueBefore` ⇔ `c <= latestCreatedForDue(dueBefore)`.
 */
export function latestCreatedForDue(dueBefore: Date, hours: SupportHours, timeZone: string): Date {
  const w = new WorkingTime(hours, timeZone, dueBefore);
  const local = dueBefore.getTime() + w.offsetMs;
  const created = w.sub(w.backward(local), hours.first_response_business_days * w.dayLength);
  return new Date(created - w.offsetMs);
}
