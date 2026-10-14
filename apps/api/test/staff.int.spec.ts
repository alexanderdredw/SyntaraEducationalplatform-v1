import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { schema } from '@syntara/db';
import { DEMO_IDS } from '@syntara/db/seed';
import { ACCOUNTS, freshIp, login, newKey, type Session } from './support/session';
import { startStack, type TestStack } from './support/stack';

describe('staff queues (integration)', () => {
  let stack: TestStack;
  let support: Session;
  let onboarding: Session;
  let teacher: Session;
  const http = () => request(stack.app.getHttpServer());

  const as = (s: Session) => ({
    get: (path: string) => http().get(path).set('Cookie', s.cookie),
    post: (path: string, body: object = {}) =>
      http().post(path).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).send(body),
  });

  async function createTicket(
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string; publicNumber: string }> {
    const res = await http()
      .post('/api/public/support-tickets')
      .set('X-Forwarded-For', freshIp())
      .set('Idempotency-Key', newKey())
      .send({
        category: 'technical',
        subject: 'Не работает квиз',
        email: 'client@example.kz',
        description: 'Описание',
        techContext: {
          route: '/ru/support',
          appVersion: '0.0.0',
          locale: 'ru',
          dataSaver: false,
          userAgent: 'Vitest',
        },
        ...overrides,
      })
      .expect(201);
    const [row] = await stack.db
      .select({ id: schema.supportTickets.id })
      .from(schema.supportTickets)
      .where(eq(schema.supportTickets.publicNumber, res.body.publicNumber));
    return { id: row!.id, publicNumber: res.body.publicNumber };
  }

  async function createRequest(email = 'school@example.kz'): Promise<{ id: string; publicNumber: string }> {
    const res = await http()
      .post('/api/public/school-requests')
      .set('X-Forwarded-For', freshIp())
      .set('Idempotency-Key', newKey())
      .send({ schoolName: 'Школа №7', contactPerson: 'Завуч', email })
      .expect(201);
    const [row] = await stack.db
      .select({ id: schema.schoolRequests.id })
      .from(schema.schoolRequests)
      .where(eq(schema.schoolRequests.publicNumber, res.body.publicNumber));
    return { id: row!.id, publicNumber: res.body.publicNumber };
  }

  /** Токен ответа, как его создаёт worker при отправке письма (в БД — только хеш). */
  async function replyToken(ticketId: string): Promise<string> {
    const token = randomBytes(24).toString('base64url');
    await stack.db.insert(schema.ticketReplyTokens).values({
      ticketId,
      tokenHash: createHash('sha256').update(token).digest(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    return token;
  }

  async function setInbound(enabled: boolean) {
    await stack.db
      .update(schema.featureFlags)
      .set({ enabled })
      .where(eq(schema.featureFlags.key, 'support.inbound_email'));
  }

  beforeAll(async () => {
    stack = await startStack('demo');
    [support, onboarding, teacher] = await Promise.all([
      login(http, ACCOUNTS.support),
      login(http, ACCOUNTS.onboarding),
      login(http, ACCOUNTS.teacher),
    ]);
  });

  afterAll(() => stack?.stop());

  describe('access (REQ-SUP-01, BR-ACL-04)', () => {
    const ticketRoutes = ['/api/staff/tickets'];
    const requestRoutes = ['/api/staff/requests'];

    it('BR-ACL-04 guest → 401 on every staff route', async () => {
      for (const path of [...ticketRoutes, ...requestRoutes]) await http().get(path).expect(401);
      await http()
        .post('/api/staff/tickets/00000000-0000-0000-0000-000000000000/status')
        .send({ to: 'resolved' })
        .expect(401);
    });

    it('BR-ACL-04 teacher (learning role) → 403 on staff queues', async () => {
      for (const path of [...ticketRoutes, ...requestRoutes]) {
        const res = await as(teacher).get(path).expect(403);
        expect(res.body.code).toBe('FORBIDDEN');
      }
    });

    it('REQ-GEN-ACL support_agent sees tickets only; onboarding_agent sees school requests only', async () => {
      await as(support).get('/api/staff/tickets').expect(200);
      await as(support).get('/api/staff/requests').expect(403);
      await as(onboarding).get('/api/staff/requests').expect(200);
      await as(onboarding).get('/api/staff/tickets').expect(403);
    });

    it('API-GEN-08 unknown or malformed ID → 404', async () => {
      await as(support).get('/api/staff/tickets/0190a1b2-0000-7000-8000-000000000000').expect(404);
      await as(support).get('/api/staff/tickets/not-a-uuid').expect(404);
      await as(onboarding).get('/api/staff/requests/0190a1b2-0000-7000-8000-000000000000').expect(404);
    });

    it('REQ-NFR-SEC-03 staff actions require the CSRF header', async () => {
      const { id } = await createTicket();
      await http()
        .post(`/api/staff/tickets/${id}/assign`)
        .set('Cookie', support.cookie)
        .send({ assigneeId: support.userId })
        .expect(403);
    });
  });

  it('AC-SUP-01 assign self → reply from template → internal note → resolve: statuses, email, history, author', async () => {
    const { id, publicNumber } = await createTicket();

    const card = await as(support).get(`/api/staff/tickets/${id}`).expect(200);
    expect(card.body).toMatchObject({
      status: 'new',
      techContext: { route: '/ru/support', locale: 'ru' },
      messages: [],
      allowedStatuses: [],
    });
    const confirmation = card.body.templates.find((t: { code: string }) => t.code === 'confirmation');
    expect(confirmation.body).toContain(publicNumber);
    expect(card.body.templates.map((t: { code: string }) => t.code).sort()).toEqual([
      'clarification',
      'confirmation',
      'delay',
      'resolution',
    ]);

    const assigned = await as(support)
      .post(`/api/staff/tickets/${id}/assign`, { assigneeId: support.userId })
      .expect(200);
    expect(assigned.body).toMatchObject({
      status: 'in_progress',
      assignee: { id: DEMO_IDS.support, displayName: 'Demo Support' },
    });

    const replied = await as(support)
      .post(`/api/staff/tickets/${id}/reply`, { body: confirmation.body, templateCode: 'confirmation' })
      .expect(200);
    expect(replied.body.status).toBe('in_progress');
    expect(replied.body.messages).toEqual([
      expect.objectContaining({
        direction: 'out',
        isInternal: false,
        body: confirmation.body,
        author: { id: DEMO_IDS.support, displayName: 'Demo Support' },
        sentAt: null,
      }),
    ]);

    const noted = await as(support)
      .post(`/api/staff/tickets/${id}/notes`, { body: 'Секретная внутренняя заметка' })
      .expect(200);
    expect(noted.body.messages[1]).toMatchObject({
      direction: 'note',
      isInternal: true,
      body: 'Секретная внутренняя заметка',
    });

    const resolved = await as(support)
      .post(`/api/staff/tickets/${id}/status`, { to: 'resolved' })
      .expect(200);
    expect(resolved.body.status).toBe('resolved');
    expect(resolved.body.resolvedAt).not.toBeNull();
    expect(resolved.body.history).toEqual([
      expect.objectContaining({
        fromStatus: 'new',
        toStatus: 'in_progress',
        changedBy: { id: DEMO_IDS.support, displayName: 'Demo Support' },
      }),
      expect.objectContaining({
        fromStatus: 'in_progress',
        toStatus: 'resolved',
        changedBy: { id: DEMO_IDS.support, displayName: 'Demo Support' },
      }),
    ]);

    // Письмо в очереди и событие outbox; заметка в письмо не попала.
    const emails = await stack.db
      .select()
      .from(schema.emailQueue)
      .where(eq(schema.emailQueue.template, 'ticket.reply'));
    const replyEmail = emails.find((e) => (e.payload as { ticketId: string }).ticketId === id);
    expect(replyEmail).toMatchObject({ toEmail: 'client@example.kz', status: 'pending' });
    expect(JSON.stringify(replyEmail!.payload)).not.toContain('Секретная внутренняя заметка');
    const events = await stack.db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.type, 'email.ticket_reply'));
    expect(events.some((e) => (e.payload as { emailQueueId: string }).emailQueueId === replyEmail!.id)).toBe(
      true,
    );
  });

  it('REQ-NFR-SEC-05, BR-SUP-03 status and assignee changes are written to audit_log with the actor', async () => {
    const { id } = await createTicket();
    await as(support).post(`/api/staff/tickets/${id}/assign`, { assigneeId: support.userId }).expect(200);
    await as(support).post(`/api/staff/tickets/${id}/status`, { to: 'waiting_internal' }).expect(200);
    const audit = await stack.db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, id));
    expect(audit.map((a) => [a.action, a.before, a.after, a.actorId])).toEqual([
      ['assign', { assigneeId: null }, { assigneeId: DEMO_IDS.support }, DEMO_IDS.support],
      ['status_change', { status: 'new' }, { status: 'in_progress' }, DEMO_IDS.support],
      ['status_change', { status: 'in_progress' }, { status: 'waiting_internal' }, DEMO_IDS.support],
    ]);
  });

  it('SM-TICKET disallowed transitions → 409 INVALID_TRANSITION and nothing changes', async () => {
    const { id } = await createTicket();
    for (const to of ['resolved', 'closed', 'reopened', 'in_progress', 'waiting_user']) {
      const res = await as(support).post(`/api/staff/tickets/${id}/status`, { to }).expect(409);
      expect(res.body.code).toBe('INVALID_TRANSITION');
    }
    await as(support).post(`/api/staff/tickets/${id}/assign`, { assigneeId: support.userId }).expect(200);
    await as(support).post(`/api/staff/tickets/${id}/status`, { to: 'closed' }).expect(409);
    const [ticket] = await stack.db
      .select()
      .from(schema.supportTickets)
      .where(eq(schema.supportTickets.id, id));
    expect(ticket!.status).toBe('in_progress');
  });

  it('REQ-SUP-03 escalation and ask_user follow SM-TICKET', async () => {
    const { id } = await createTicket();
    await as(support).post(`/api/staff/tickets/${id}/assign`, { assigneeId: support.userId }).expect(200);
    const escalated = await as(support)
      .post(`/api/staff/tickets/${id}/status`, { to: 'waiting_internal' })
      .expect(200);
    expect(escalated.body.allowedStatuses.sort()).toEqual(['in_progress', 'resolved']);
    await as(support).post(`/api/staff/tickets/${id}/status`, { to: 'in_progress' }).expect(200);
    const asked = await as(support)
      .post(`/api/staff/tickets/${id}/status`, { to: 'waiting_user' })
      .expect(200);
    expect(asked.body.allowedStatuses).toEqual(['resolved']);
  });

  it('API-SUP-03 only a support agent can be the assignee', async () => {
    const { id } = await createTicket();
    const res = await as(support)
      .post(`/api/staff/tickets/${id}/assign`, { assigneeId: DEMO_IDS.teacher })
      .expect(400);
    expect(res.body.fieldErrors).toEqual({ assigneeId: 'invalidAssignee' });
  });

  it('API-SUP-04, SM-TICKET reply with «Уточнение» → waiting_user, with «Решение» → resolved; manual change stays', async () => {
    const { id } = await createTicket();
    const tpl = async (code: string) =>
      (await as(support).get(`/api/staff/tickets/${id}`).expect(200)).body.templates.find(
        (t: { code: string }) => t.code === code,
      ).body as string;

    // Без назначения (new) переход ask_user недопустим — ответ уходит, статус не меняется.
    const early = await as(support)
      .post(`/api/staff/tickets/${id}/reply`, {
        body: await tpl('clarification'),
        templateCode: 'clarification',
      })
      .expect(200);
    expect(early.body.status).toBe('new');

    await as(support).post(`/api/staff/tickets/${id}/assign`, { assigneeId: support.userId }).expect(200);
    const asked = await as(support)
      .post(`/api/staff/tickets/${id}/reply`, {
        body: await tpl('clarification'),
        templateCode: 'clarification',
      })
      .expect(200);
    expect(asked.body.status).toBe('waiting_user');
    expect(asked.body.history.at(-1)).toMatchObject({ fromStatus: 'in_progress', toStatus: 'waiting_user' });

    const resolved = await as(support)
      .post(`/api/staff/tickets/${id}/reply`, { body: await tpl('resolution'), templateCode: 'resolution' })
      .expect(200);
    expect(resolved.body.status).toBe('resolved');
    expect(resolved.body.resolvedAt).not.toBeNull();
    expect(resolved.body.messages.filter((m: { direction: string }) => m.direction === 'out')).toHaveLength(
      3,
    );
  });

  it('API-SUP-04 replies without a template or with «Подтверждение»/«Задержка» do not change the status', async () => {
    const { id } = await createTicket();
    await as(support).post(`/api/staff/tickets/${id}/assign`, { assigneeId: support.userId }).expect(200);
    for (const body of [{ body: 'Свой текст' }, { body: 'Ждите', templateCode: 'delay' }]) {
      const res = await as(support).post(`/api/staff/tickets/${id}/reply`, body).expect(200);
      expect(res.body.status).toBe('in_progress');
    }
  });

  it('API-SUP-04 unknown template code → 400; empty body → 400', async () => {
    const { id } = await createTicket();
    const unknown = await as(support)
      .post(`/api/staff/tickets/${id}/reply`, { body: 'x', templateCode: 'nope' })
      .expect(400);
    expect(unknown.body.fieldErrors).toEqual({ templateCode: 'invalidTemplate' });
    const empty = await as(support).post(`/api/staff/tickets/${id}/reply`, { body: '  ' }).expect(400);
    expect(empty.body.fieldErrors).toEqual({ body: 'required' });
  });

  it('API-SUP-01, API-GEN-07 filters by number, email, status, category, assignee and paginates with a cursor', async () => {
    const a = await createTicket({ email: 'filter-a@example.kz', category: 'learning' });
    const b = await createTicket({ email: 'filter-b@example.kz', category: 'learning' });
    await as(support).post(`/api/staff/tickets/${b.id}/assign`, { assigneeId: support.userId }).expect(200);

    const byNumber = await as(support).get(`/api/staff/tickets?q=${a.publicNumber}`).expect(200);
    expect(byNumber.body.items.map((i: { id: string }) => i.id)).toEqual([a.id]);
    const byEmail = await as(support).get('/api/staff/tickets?q=filter-b@').expect(200);
    expect(byEmail.body.items.map((i: { id: string }) => i.id)).toEqual([b.id]);
    const learning = await as(support).get('/api/staff/tickets?category=learning').expect(200);
    expect(learning.body.items.map((i: { id: string }) => i.id)).toEqual([b.id, a.id]);
    const inProgress = await as(support)
      .get('/api/staff/tickets?category=learning&status=in_progress')
      .expect(200);
    expect(inProgress.body.items.map((i: { id: string }) => i.id)).toEqual([b.id]);
    const mine = await as(support)
      .get(`/api/staff/tickets?category=learning&assigneeId=${support.userId}`)
      .expect(200);
    expect(mine.body.items.map((i: { id: string }) => i.id)).toEqual([b.id]);
    const none = await as(support).get('/api/staff/tickets?category=learning&assigneeId=none').expect(200);
    expect(none.body.items.map((i: { id: string }) => i.id)).toEqual([a.id]);

    const page1 = await as(support).get('/api/staff/tickets?category=learning&limit=1').expect(200);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.nextCursor).toEqual(expect.any(String));
    const page2 = await as(support)
      .get(`/api/staff/tickets?category=learning&limit=1&cursor=${page1.body.nextCursor}`)
      .expect(200);
    expect(page2.body.items.map((i: { id: string }) => i.id)).toEqual([a.id]);
    expect(page2.body.nextCursor).toBeNull();

    await as(support).get('/api/staff/tickets?limit=101').expect(400);
    await as(support).get('/api/staff/tickets?status=bogus').expect(400);
  });

  it('REQ-SUP-01, REQ-SUP-04 «срок» filter uses the first-response target (PH-22)', async () => {
    const { id } = await createTicket({ email: 'due@example.kz', category: 'data_privacy' });
    const list = await as(support).get('/api/staff/tickets?category=data_privacy').expect(200);
    const item = list.body.items.find((i: { id: string }) => i.id === id);
    const due = new Date(item.dueAt).getTime();
    const created = new Date(item.createdAt).getTime();
    expect(due - created).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
    expect(due - created).toBeLessThanOrEqual(3 * 24 * 60 * 60 * 1000);

    const before = new Date(due - 1000).toISOString();
    const after = new Date(due + 1000).toISOString();
    const notYet = await as(support)
      .get(`/api/staff/tickets?category=data_privacy&dueBefore=${encodeURIComponent(before)}`)
      .expect(200);
    expect(notYet.body.items.map((i: { id: string }) => i.id)).not.toContain(id);
    const due1 = await as(support)
      .get(`/api/staff/tickets?category=data_privacy&dueBefore=${encodeURIComponent(after)}`)
      .expect(200);
    expect(due1.body.items.map((i: { id: string }) => i.id)).toContain(id);
  });

  describe('school requests (API-SUP-07, SM-REQUEST)', () => {
    it('SM-REQUEST new → in_progress → contacted → onboarded; skipping a step → 409', async () => {
      const { id } = await createRequest('flow@example.kz');
      const skip = await as(onboarding)
        .post(`/api/staff/requests/${id}/status`, { to: 'contacted' })
        .expect(409);
      expect(skip.body.code).toBe('INVALID_TRANSITION');
      const assigned = await as(onboarding)
        .post(`/api/staff/requests/${id}/assign`, { assigneeId: onboarding.userId })
        .expect(200);
      expect(assigned.body.assignee).toEqual({ id: DEMO_IDS.onboarding, displayName: 'Demo Onboarding' });
      for (const to of ['in_progress', 'contacted', 'onboarded']) {
        const res = await as(onboarding).post(`/api/staff/requests/${id}/status`, { to }).expect(200);
        expect(res.body.status).toBe(to);
      }
      const final = await as(onboarding).get(`/api/staff/requests/${id}`).expect(200);
      expect(final.body.allowedStatuses).toEqual([]);
      await as(onboarding).post(`/api/staff/requests/${id}/status`, { to: 'rejected' }).expect(409);

      const audit = await stack.db
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.entityType, 'school_request'), eq(schema.auditLog.entityId, id)));
      expect(audit.map((a) => a.action)).toEqual([
        'assign',
        'status_change',
        'status_change',
        'status_change',
      ]);
    });

    it('API-SUP-07 list with search and status filter; support agent cannot be assigned', async () => {
      const { id, publicNumber } = await createRequest('search@example.kz');
      const byNumber = await as(onboarding).get(`/api/staff/requests?q=${publicNumber}`).expect(200);
      expect(byNumber.body.items).toEqual([
        expect.objectContaining({
          id,
          schoolName: 'Школа №7',
          contactPerson: 'Завуч',
          status: 'new',
          assignee: null,
        }),
      ]);
      const res = await as(onboarding)
        .post(`/api/staff/requests/${id}/assign`, { assigneeId: support.userId })
        .expect(400);
      expect(res.body.fieldErrors).toEqual({ assigneeId: 'invalidAssignee' });
    });
  });

  describe('inbound email (API-SUP-08, BR-SUP-01)', () => {
    afterEach(() => setInbound(false));

    it('API-SUP-08 is disabled by the feature flag until a mail provider is chosen (Q-10)', async () => {
      const { id } = await createTicket();
      const token = await replyToken(id);
      await http()
        .post('/api/inbound/email')
        .send({ token, from: 'client@example.kz', text: 'Ответ' })
        .expect(404);
    });

    it('AC-SUP-02 user reply to a resolved ticket → reopened; message stored; history written', async () => {
      await setInbound(true);
      const { id } = await createTicket();
      await as(support).post(`/api/staff/tickets/${id}/assign`, { assigneeId: support.userId }).expect(200);
      await as(support).post(`/api/staff/tickets/${id}/status`, { to: 'resolved' }).expect(200);
      const token = await replyToken(id);

      await http()
        .post('/api/inbound/email')
        .send({ token, from: 'client@example.kz', text: 'Не помогло' })
        .expect(204);
      const card = await as(support).get(`/api/staff/tickets/${id}`).expect(200);
      expect(card.body.status).toBe('reopened');
      expect(card.body.resolvedAt).toBeNull();
      expect(card.body.messages.at(-1)).toMatchObject({
        direction: 'in',
        body: 'Не помогло',
        isInternal: false,
      });
      expect(card.body.history.at(-1)).toMatchObject({
        fromStatus: 'resolved',
        toStatus: 'reopened',
        changedBy: null,
      });

      // reopened --assign--> in_progress
      const again = await as(support)
        .post(`/api/staff/tickets/${id}/assign`, { assigneeId: support.userId })
        .expect(200);
      expect(again.body.status).toBe('in_progress');
    });

    it('BR-SUP-01 reply to a closed ticket → reopened; reply while waiting_user → in_progress', async () => {
      await setInbound(true);
      const closed = await createTicket();
      await stack.db
        .update(schema.supportTickets)
        .set({ status: 'closed' })
        .where(eq(schema.supportTickets.id, closed.id));
      await http()
        .post('/api/inbound/email')
        .send({ token: await replyToken(closed.id), from: 'client@example.kz', text: 'Снова' })
        .expect(204);
      const [reopened] = await stack.db
        .select()
        .from(schema.supportTickets)
        .where(eq(schema.supportTickets.id, closed.id));
      expect(reopened!.status).toBe('reopened');

      const waiting = await createTicket();
      await as(support)
        .post(`/api/staff/tickets/${waiting.id}/assign`, { assigneeId: support.userId })
        .expect(200);
      await as(support).post(`/api/staff/tickets/${waiting.id}/status`, { to: 'waiting_user' }).expect(200);
      await http()
        .post('/api/inbound/email')
        .send({ token: await replyToken(waiting.id), from: 'client@example.kz', text: 'Уточняю' })
        .expect(204);
      const [resumed] = await stack.db
        .select()
        .from(schema.supportTickets)
        .where(eq(schema.supportTickets.id, waiting.id));
      expect(resumed!.status).toBe('in_progress');
    });

    it('API-SUP-08 unknown or expired token → 404', async () => {
      await setInbound(true);
      await http()
        .post('/api/inbound/email')
        .send({ token: 'x'.repeat(32), from: 'client@example.kz', text: 'Ответ' })
        .expect(404);
      const { id } = await createTicket();
      const token = randomBytes(24).toString('base64url');
      await stack.db.insert(schema.ticketReplyTokens).values({
        ticketId: id,
        tokenHash: createHash('sha256').update(token).digest(),
        expiresAt: new Date(Date.now() - 1000),
      });
      await http()
        .post('/api/inbound/email')
        .send({ token, from: 'client@example.kz', text: 'Ответ' })
        .expect(404);
    });
  });

  it('API-GEN-01 OpenAPI documents API-SUP-01..08', async () => {
    const { buildOpenApi } = await import('../src/setup');
    const doc = buildOpenApi(stack.app);
    expect(doc.paths['/api/staff/tickets']?.get).toBeDefined();
    expect(doc.paths['/api/staff/tickets/{id}']?.get).toBeDefined();
    for (const action of ['assign', 'reply', 'notes', 'status']) {
      expect(doc.paths[`/api/staff/tickets/{id}/${action}`]?.post, action).toBeDefined();
    }
    expect(doc.paths['/api/staff/requests']?.get).toBeDefined();
    expect(doc.paths['/api/staff/requests/{id}/status']?.post).toBeDefined();
    expect(doc.paths['/api/inbound/email']?.post).toBeDefined();
  });
});
