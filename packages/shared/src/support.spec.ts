import { describe, expect, it } from 'vitest';
import { RequestStatus, TicketStatus } from './enums';
import {
  canTransitionRequest,
  dueOffsetDays,
  firstResponseDueAt,
  staffStatusTargets,
  TICKET_TRANSITIONS,
  ticketTransition,
  workingIsoDays,
} from './support';

describe('SM-TICKET', () => {
  /** Все рёбра автомата раздела 9 (событие, из, в). */
  const allowed: Array<[string, string, string]> = [
    ['assign', 'new', 'in_progress'],
    ['assign', 'reopened', 'in_progress'],
    ['ask_user', 'in_progress', 'waiting_user'],
    ['user_reply', 'waiting_user', 'in_progress'],
    ['escalate', 'in_progress', 'waiting_internal'],
    ['resume', 'waiting_internal', 'in_progress'],
    ['resolve', 'in_progress', 'resolved'],
    ['resolve', 'waiting_user', 'resolved'],
    ['resolve', 'waiting_internal', 'resolved'],
    ['auto_close', 'resolved', 'closed'],
    ['user_reply', 'resolved', 'reopened'],
    ['user_reply', 'closed', 'reopened'],
  ];

  it('SM-TICKET allows exactly the transitions of section 9', () => {
    const actual = TICKET_TRANSITIONS.flatMap((t) => t.from.map((from) => [t.event, from, t.to]));
    expect(actual.sort()).toEqual([...allowed].sort());
  });

  it('SM-TICKET every allowed (event, from) pair yields its target status', () => {
    for (const [event, from, to] of allowed) {
      expect(ticketTransition(from as never, event as never), `${event} ${from}`).toBe(to);
    }
  });

  it('SM-TICKET every other (event, from) pair is rejected', () => {
    const events = [...new Set(TICKET_TRANSITIONS.map((t) => t.event))];
    for (const event of events) {
      for (const from of TicketStatus.options) {
        const expected = allowed.find(([e, f]) => e === event && f === from)?.[2] ?? null;
        expect(ticketTransition(from, event), `${event} ${from}`).toBe(expected);
      }
    }
  });

  it('API-SUP-06 staff can only ask_user, escalate, resume and resolve', () => {
    expect(staffStatusTargets('new')).toEqual([]);
    expect(staffStatusTargets('in_progress').sort()).toEqual([
      'resolved',
      'waiting_internal',
      'waiting_user',
    ]);
    expect(staffStatusTargets('waiting_user')).toEqual(['resolved']);
    expect(staffStatusTargets('waiting_internal').sort()).toEqual(['in_progress', 'resolved']);
    expect(staffStatusTargets('resolved')).toEqual([]);
    expect(staffStatusTargets('closed')).toEqual([]);
    expect(staffStatusTargets('reopened')).toEqual([]);
  });
});

describe('SM-REQUEST', () => {
  it('SM-REQUEST new → in_progress → contacted → onboarded | rejected, nothing else', () => {
    const allowed = new Set([
      'new>in_progress',
      'in_progress>contacted',
      'contacted>onboarded',
      'contacted>rejected',
    ]);
    for (const from of RequestStatus.options) {
      for (const to of RequestStatus.options) {
        expect(canTransitionRequest(from, to), `${from}>${to}`).toBe(allowed.has(`${from}>${to}`));
      }
    }
  });
});

describe('REQ-SUP-04 first response target (PH-22)', () => {
  const hours = { days: 'mon-fri', from: '09:00', to: '18:00', tz: 'UTC+5', first_response_business_days: 1 };

  it('parses working days', () => {
    expect([...workingIsoDays('mon-fri')]).toEqual([1, 2, 3, 4, 5]);
    expect([...workingIsoDays('fri-mon')].sort()).toEqual([1, 5, 6, 7]);
    expect([...workingIsoDays('mon,wed')]).toEqual([1, 3]);
  });

  it('one business day: Mon–Thu → next day, Fri → Mon, Sat → Mon, Sun → Mon', () => {
    expect(dueOffsetDays('mon-fri', 1)).toEqual({ 1: 1, 2: 1, 3: 1, 4: 1, 5: 3, 6: 2, 7: 1 });
  });

  it('computes the due date in PLATFORM_TZ', () => {
    // Пт 2026-10-16 23:30 в Алматы (UTC+5) = 18:30 UTC → срок — пн 2026-10-19 в то же время.
    const friday = new Date('2026-10-16T18:30:00Z');
    expect(firstResponseDueAt(friday, hours, 'Asia/Almaty').toISOString()).toBe('2026-10-19T18:30:00.000Z');
    // То же время по UTC — уже суббота в Алматы (Сб 00:30) → тоже понедельник.
    const saturday = new Date('2026-10-16T19:30:00Z');
    expect(firstResponseDueAt(saturday, hours, 'Asia/Almaty').toISOString()).toBe('2026-10-18T19:30:00.000Z');
  });
});
