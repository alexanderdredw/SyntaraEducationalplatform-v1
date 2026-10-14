import { describe, expect, it } from 'vitest';
import { RequestStatus, TicketStatus } from './enums';
import {
  canTransitionRequest,
  firstResponseDueAt,
  latestCreatedForDue,
  parseUtcOffset,
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

  it('parses fixed UTC offsets of PH-22', () => {
    expect(parseUtcOffset('UTC+5')).toBe(300);
    expect(parseUtcOffset('UTC-03:30')).toBe(-210);
    expect(parseUtcOffset('UTC')).toBe(0);
    expect(parseUtcOffset('Asia/Almaty')).toBeNull();
  });

  /** Время в UTC+5 → ISO UTC. */
  const kz = (local: string) => new Date(`${local}+05:00`);
  const due = (local: string) => firstResponseDueAt(kz(local), hours, 'Asia/Almaty').toISOString();

  it('REQ-SUP-04 one business day of working hours (Mon–Fri 09:00–18:00, UTC+5)', () => {
    // 2026-10-12 — понедельник.
    expect(due('2026-10-12T10:00:00')).toBe(kz('2026-10-13T10:00:00').toISOString());
    expect(due('2026-10-12T07:30:00')).toBe(kz('2026-10-12T18:00:00').toISOString());
    expect(due('2026-10-12T20:00:00')).toBe(kz('2026-10-13T18:00:00').toISOString());
    expect(due('2026-10-16T17:00:00')).toBe(kz('2026-10-19T17:00:00').toISOString());
    expect(due('2026-10-17T12:00:00')).toBe(kz('2026-10-19T18:00:00').toISOString());
    expect(due('2026-10-12T18:00:00')).toBe(kz('2026-10-13T18:00:00').toISOString());
  });

  it('REQ-SUP-01 «срок до» filter: due <= D exactly when created <= latestCreatedForDue(D)', () => {
    let seed = 42;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const start = kz('2026-10-01T00:00:00').getTime();
    const span = 30 * 24 * 60 * 60 * 1000;
    for (let i = 0; i < 2000; i++) {
      const created = new Date(start + Math.floor(random() * span));
      const d = new Date(start + Math.floor(random() * span));
      const byDue = firstResponseDueAt(created, hours, 'Asia/Almaty') <= d;
      const byBound = created <= latestCreatedForDue(d, hours, 'Asia/Almaty');
      expect(byBound, `${created.toISOString()} / ${d.toISOString()}`).toBe(byDue);
    }
  });
});
