import request from 'supertest';
import { eq, sql } from 'drizzle-orm';
import { schema } from '@syntara/db';
import { DEMO_IDS } from '@syntara/db/seed';
import { ACCOUNTS, freshIp, login, newKey } from './support/session';
import { startStack, type TestStack } from './support/stack';

const schoolRequest = {
  schoolName: 'Школа-гимназия №1',
  region: 'Алматинская обл.',
  city: 'Алматы',
  contactPerson: 'Директор',
  phone: '+7 700 000 00 00',
  email: 'school@example.kz',
  message: 'Пять классов, хотим начать в январе',
};

const supportTicket = {
  category: 'technical',
  subject: 'Не открывается урок',
  name: 'Айгерим',
  email: 'parent@example.kz',
  phone: '',
  description: 'Секретное описание проблемы',
  techContext: {
    route: '/ru/support',
    appVersion: '0.0.0',
    locale: 'kk',
    dataSaver: true,
    userAgent: 'Vitest',
  },
};

describe('public forms (integration)', () => {
  let stack: TestStack;
  const http = () => request(stack.app.getHttpServer());
  const post = (path: string, body: object, key: string | null = newKey(), ip = freshIp()) => {
    const req = http().post(path).set('X-Forwarded-For', ip).set('Accept-Language', 'ru');
    return key ? req.set('Idempotency-Key', key).send(body) : req.send(body);
  };

  beforeAll(async () => {
    stack = await startStack('demo');
  });

  afterAll(() => stack?.stop());

  it('AC-FRM-02, API-PUB-04, BR-FRM-02 valid school request → 201 { publicNumber SR-YYMMDD-NNNN, email }', async () => {
    const res = await post('/api/public/school-requests', schoolRequest).expect(201);
    expect(res.body).toEqual({
      publicNumber: expect.stringMatching(/^SR-\d{6}-\d{4}$/),
      email: 'school@example.kz',
    });
    const rows = await stack.db
      .select()
      .from(schema.schoolRequests)
      .where(eq(schema.schoolRequests.publicNumber, res.body.publicNumber));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ schoolName: 'Школа-гимназия №1', status: 'new', assigneeId: null });
  });

  it('AC-FRM-02, BR-FRM-01 record, idempotency key, email_queue and outbox event are written in one transaction', async () => {
    const key = newKey();
    const res = await post(
      '/api/public/school-requests',
      { ...schoolRequest, email: 'tx@example.kz' },
      key,
    ).expect(201);
    const xmin = async (table: string, where: string) => {
      const rows = await stack.db.execute<{ xmin: string }>(
        sql.raw(`SELECT xmin::text AS xmin FROM ${table} WHERE ${where}`),
      );
      return rows.map((r) => r.xmin);
    };
    const [requestTx] = await xmin('school_requests', `public_number = '${res.body.publicNumber}'`);
    const [keyTx] = await xmin('idempotency_keys', `key = '${key}'`);
    const [email] = await stack.db
      .select()
      .from(schema.emailQueue)
      .where(eq(schema.emailQueue.toEmail, 'tx@example.kz'));
    const [emailTx] = await xmin('email_queue', `id = '${email!.id}'`);
    const [event] = await stack.db
      .select()
      .from(schema.outboxEvents)
      .where(sql`${schema.outboxEvents.payload}->>'emailQueueId' = ${email!.id}`);
    const [eventTx] = await xmin('outbox_events', `id = '${event!.id}'`);
    expect(event).toMatchObject({ type: 'email.confirmation', processedAt: null });
    expect(new Set([requestTx, keyTx, emailTx, eventTx]).size).toBe(1);
  });

  it('AC-FRM-02, BR-FRM-01 failure while writing the outbox event rolls back the whole submission', async () => {
    await stack.db.execute(sql`CREATE FUNCTION fail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'outbox down'; END $$`);
    await stack.db.execute(
      sql`CREATE TRIGGER fail_outbox BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_outbox()`,
    );
    try {
      const key = newKey();
      const res = await post(
        '/api/public/school-requests',
        { ...schoolRequest, email: 'rollback@example.kz' },
        key,
      ).expect(500);
      expect(res.body.code).toBe('INTERNAL_ERROR');
      const rows = await stack.db
        .select()
        .from(schema.schoolRequests)
        .where(eq(schema.schoolRequests.email, 'rollback@example.kz'));
      expect(rows).toHaveLength(0);
      expect(
        await stack.db.select().from(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.key, key)),
      ).toHaveLength(0);
      expect(
        await stack.db
          .select()
          .from(schema.emailQueue)
          .where(eq(schema.emailQueue.toEmail, 'rollback@example.kz')),
      ).toHaveLength(0);
    } finally {
      await stack.db.execute(sql`DROP TRIGGER fail_outbox ON outbox_events`);
      await stack.db.execute(sql`DROP FUNCTION fail_outbox()`);
    }
  });

  it('AC-FRM-03, API-GEN-05 retry with the same key and body returns the same response and creates one record', async () => {
    const key = newKey();
    const body = { ...schoolRequest, email: 'retry@example.kz' };
    const first = await post('/api/public/school-requests', body, key).expect(201);
    // Тот же JSON с другим порядком полей — то же тело.
    const reordered = Object.fromEntries(Object.entries(body).reverse());
    const second = await post('/api/public/school-requests', reordered, key).expect(201);
    expect(second.body).toEqual(first.body);
    const rows = await stack.db
      .select()
      .from(schema.schoolRequests)
      .where(eq(schema.schoolRequests.email, 'retry@example.kz'));
    expect(rows).toHaveLength(1);
    const emails = await stack.db
      .select()
      .from(schema.emailQueue)
      .where(eq(schema.emailQueue.toEmail, 'retry@example.kz'));
    expect(emails).toHaveLength(1);
  });

  it('AC-FRM-03, API-GEN-05 parallel duplicates with one key still create exactly one record', async () => {
    const key = newKey();
    const body = { ...schoolRequest, email: 'parallel@example.kz' };
    const responses = await Promise.all([1, 2, 3].map(() => post('/api/public/school-requests', body, key)));
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(new Set(responses.map((r) => r.body.publicNumber)).size).toBe(1);
    const rows = await stack.db
      .select()
      .from(schema.schoolRequests)
      .where(eq(schema.schoolRequests.email, 'parallel@example.kz'));
    expect(rows).toHaveLength(1);
  });

  it('API-GEN-05 same key with a different body → 409 IDEMPOTENCY_MISMATCH', async () => {
    const key = newKey();
    await post('/api/public/school-requests', { ...schoolRequest, email: 'a@example.kz' }, key).expect(201);
    const res = await post(
      '/api/public/school-requests',
      { ...schoolRequest, email: 'b@example.kz' },
      key,
    ).expect(409);
    expect(res.body.code).toBe('IDEMPOTENCY_MISMATCH');
  });

  it('API-GEN-05 Idempotency-Key header (UUID) is required', async () => {
    const missing = await post('/api/public/school-requests', schoolRequest, null).expect(400);
    expect(missing.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: { 'Idempotency-Key': 'required' },
    });
    await post('/api/public/support-tickets', supportTicket, 'not-a-uuid').expect(400);
  });

  it('AC-FRM-01 (server side) empty required fields → 400 with i18n keys per field, nothing saved', async () => {
    const before = await stack.db.select({ n: sql<number>`count(*)::int` }).from(schema.schoolRequests);
    const res = await post('/api/public/school-requests', {
      schoolName: ' ',
      contactPerson: '',
      email: 'bad',
    }).expect(400);
    expect(res.body.fieldErrors).toEqual({
      schoolName: 'required',
      contactPerson: 'required',
      email: 'email',
    });
    const after = await stack.db.select({ n: sql<number>`count(*)::int` }).from(schema.schoolRequests);
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  it('API-PUB-05, BR-FRM-02, REQ-PUB-SUP-03 support ticket → 201 T-YYMMDD-NNNN; techContext stored', async () => {
    const res = await post('/api/public/support-tickets', supportTicket).expect(201);
    expect(res.body).toEqual({
      publicNumber: expect.stringMatching(/^T-\d{6}-\d{4}$/),
      email: 'parent@example.kz',
    });
    const [ticket] = await stack.db
      .select()
      .from(schema.supportTickets)
      .where(eq(schema.supportTickets.publicNumber, res.body.publicNumber));
    expect(ticket).toMatchObject({
      category: 'technical',
      status: 'new',
      phone: null,
      userId: null,
      techContext: supportTicket.techContext,
    });
  });

  it('BR-FRM-03 confirmation email payload has number, type and reply channel, never the description', async () => {
    const res = await post('/api/public/support-tickets', {
      ...supportTicket,
      email: 'payload@example.kz',
    }).expect(201);
    const [email] = await stack.db
      .select()
      .from(schema.emailQueue)
      .where(eq(schema.emailQueue.toEmail, 'payload@example.kz'));
    expect(email).toMatchObject({ template: 'support_ticket.confirmation', status: 'pending', attempts: 0 });
    expect(email!.payload).toEqual({
      locale: 'ru',
      publicNumber: res.body.publicNumber,
      replyEmail: 'payload@example.kz',
      category: 'technical',
    });
    expect(JSON.stringify(email!.payload)).not.toContain('Секретное описание');
  });

  it('API-PUB-05 a ticket from a signed-in user is linked to the account', async () => {
    const session = await login(http, ACCOUNTS.teacher);
    const res = await http()
      .post('/api/public/support-tickets')
      .set('X-Forwarded-For', freshIp())
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .set('Idempotency-Key', newKey())
      .send({ ...supportTicket, email: 'teacher-ticket@example.kz' })
      .expect(201);
    const [ticket] = await stack.db
      .select()
      .from(schema.supportTickets)
      .where(eq(schema.supportTickets.publicNumber, res.body.publicNumber));
    expect(ticket!.userId).toBe(DEMO_IDS.teacher);
  });

  it('API-GEN-06 forms: 5 per minute per IP, then 429 with retryAfterSeconds; another IP is not affected', async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) {
      await post(
        '/api/public/support-tickets',
        { ...supportTicket, email: `limit${i}@example.kz` },
        newKey(),
        ip,
      ).expect(201);
    }
    const limited = await post('/api/public/school-requests', schoolRequest, newKey(), ip).expect(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    expect(limited.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(limited.body.retryAfterSeconds).toBeLessThanOrEqual(60);
    await post('/api/public/school-requests', schoolRequest, newKey(), freshIp()).expect(201);
  });

  it('API-GEN-01 OpenAPI documents API-PUB-04 and API-PUB-05 with the Idempotency-Key header', async () => {
    const { buildOpenApi } = await import('../src/setup');
    const doc = buildOpenApi(stack.app);
    for (const path of ['/api/public/school-requests', '/api/public/support-tickets']) {
      const op = doc.paths[path]?.post;
      expect(op).toBeDefined();
      expect(op!.parameters).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'Idempotency-Key', required: true })]),
      );
      expect(op!.responses['201']).toBeDefined();
    }
  });
});
