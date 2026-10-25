import request from 'supertest';
import { and, eq, sql } from 'drizzle-orm';
import { OUTBOX_EVENT_TYPES } from '@syntara/shared';
import { schema } from '@syntara/db';
import { ACCOUNTS, freshIp, login, type Session } from './support/session';
import { startStack, type TestStack } from './support/stack';

const { mediaFiles, userProfiles, auditLog, outboxEvents, users } = schema;

/**
 * docs/PROFILE_TZ.md, SPEC 7.15 / 8.7: профиль (API-ME-06…09). Только свой профиль; имя меняется вместе с
 * users.display_name и не чаще 3 раз за 30 дней; «Должность» и «О себе» — только учитель; своя картинка — только
 * учитель (решение владельца 2026-10-25), не более 5 загрузок за 24 часа.
 */
describe('profile (integration)', () => {
  let stack: TestStack;
  let n = 0;
  const http = () => request(stack.app.getHttpServer());
  const as = (s: Session) => ({
    get: (path: string) => http().get(path).set('Cookie', s.cookie),
    send: (method: 'post' | 'patch' | 'put', path: string, body: object = {}) =>
      http()
        [method](path)
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', s.csrf)
        .set('X-Forwarded-For', freshIp())
        .send(body),
  });

  async function newStudent(displayName = 'Асель Касымова'): Promise<Session> {
    const loginName = `prf.student.${++n}`;
    await http()
      .post('/api/auth/register-student')
      .set('X-Forwarded-For', freshIp())
      .send({ displayName, login: loginName, password: 'student-pass-1' })
      .expect(201);
    return login(http, loginName, 'student-pass-1');
  }

  async function newTeacher(displayName = 'Алия Нурланова'): Promise<Session> {
    const email = `prf.teacher.${++n}@example.com`;
    await http()
      .post('/api/auth/register')
      .set('X-Forwarded-For', freshIp())
      .send({ role: 'teacher', email, displayName, password: 'teacher-pass-1' })
      .expect(201);
    return login(http, email, 'teacher-pass-1');
  }

  async function media(ownerId: string, scanStatus: 'pending' | 'clean' | 'rejected' = 'clean') {
    const [row] = await stack.db
      .insert(mediaFiles)
      .values({
        ownerId,
        kind: 'avatar',
        originalName: 'me.jpg',
        mime: 'image/webp',
        sizeBytes: 100,
        storageKey: `avatar/${crypto.randomUUID()}`,
        scanStatus,
      })
      .returning();
    return row!;
  }

  beforeAll(async () => {
    stack = await startStack('demo');
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('AC-PRF-01 registration creates a profile from the entered name; the avatar starts as initials', async () => {
    const teacher = await newTeacher('Алия Нурланова');
    const profile = (await as(teacher).get('/api/me/profile').expect(200)).body;
    expect(profile).toMatchObject({
      firstName: 'Алия',
      lastName: 'Нурланова',
      role: 'teacher',
      email: expect.stringContaining('@example.com'),
      login: null,
      canUploadPhoto: true,
      canRemoveEmail: false,
      nameChangesLeft: 3,
    });
    expect(profile.avatar).toMatchObject({
      kind: 'initials',
      initials: 'АН',
      photoUrl: null,
      photoStatus: null,
    });
    const me = (await as(teacher).get('/api/me').expect(200)).body;
    expect(me.avatar).toMatchObject({ kind: 'initials', initials: 'АН' });

    const student = await newStudent('Ерлан');
    expect((await as(student).get('/api/me/profile').expect(200)).body).toMatchObject({
      firstName: 'Ерлан',
      lastName: null,
      role: 'student',
      login: expect.stringMatching(/^prf\.student\./),
      email: null,
      position: null,
      about: null,
      canUploadPhoto: false,
    });
  });

  it('AC-PRF-03 BR-PRF-01 a new name is visible at once (display_name, /api/me, roster); the 4th change in 30 days → 429 with a retry time', async () => {
    const teacher = await login(http, ACCOUNTS.teacher);
    const classId = (await as(teacher).send('post', '/api/teacher/classes', { name: 'ПРФ' }).expect(201)).body
      .id as string;
    const code = (await as(teacher).send('post', `/api/teacher/classes/${classId}/invite-codes`).expect(201))
      .body.code as string;
    const student = await newStudent('Данияр Ахметов');
    await as(student).send('post', '/api/student/join', { code }).expect(200);

    const renamed = await as(student)
      .send('patch', '/api/me/profile', { firstName: 'Даниял', lastName: 'Ахмет-Ұлы' })
      .expect(200);
    expect(renamed.body).toMatchObject({ firstName: 'Даниял', lastName: 'Ахмет-Ұлы', nameChangesLeft: 2 });
    expect((await as(student).get('/api/me').expect(200)).body.displayName).toBe('Даниял Ахмет-Ұлы');
    const [row] = await stack.db.select().from(users).where(eq(users.id, student.userId));
    expect(row!.displayName).toBe('Даниял Ахмет-Ұлы');
    const roster = (await as(teacher).get(`/api/teacher/classes/${classId}/roster`).expect(200))
      .body as Array<{
      id: string;
      displayName: string;
    }>;
    expect(roster.find((r) => r.id === student.userId)?.displayName).toBe('Даниял Ахмет-Ұлы');

    // Тот же текст — не изменение имени (лимит не тратится); фамилию можно убрать.
    expect(
      (
        await as(student)
          .send('patch', '/api/me/profile', { firstName: 'Даниял', lastName: 'Ахмет-Ұлы' })
          .expect(200)
      ).body.nameChangesLeft,
    ).toBe(2);
    await as(student).send('patch', '/api/me/profile', { lastName: '' }).expect(200);
    expect((await as(student).get('/api/me').expect(200)).body.displayName).toBe('Даниял');
    const third = (await as(student).send('patch', '/api/me/profile', { firstName: 'Данияр' }).expect(200))
      .body;
    expect(third.nameChangesLeft).toBe(0);
    expect(new Date(third.nameChangeAvailableAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);

    const limited = await as(student).send('patch', '/api/me/profile', { firstName: 'Дани' }).expect(429);
    expect(limited.body.fieldErrors).toEqual({ firstName: 'nameChangeLimit' });
    expect(limited.body.retryAfterSeconds).toBeGreaterThan(29 * 86_400);
    expect((await as(student).get('/api/me').expect(200)).body.displayName).toBe('Данияр');

    const audit = await stack.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, student.userId), eq(auditLog.action, 'profile.name')));
    expect(audit).toHaveLength(3);
    expect(audit[0]!.before).toEqual({ displayName: 'Данияр Ахметов' });
  });

  it('BR-PRF-01 BR-PRF-04 validation: letters, space, hyphen, apostrophe; 1–40; teacher-only position and about without links', async () => {
    const student = await newStudent();
    const err = async (body: object, status = 400) =>
      (await as(student).send('patch', '/api/me/profile', body).expect(status)).body.fieldErrors;
    expect(await err({ firstName: 'Asel1' })).toEqual({ firstName: 'nameChars' });
    expect(await err({ firstName: '' })).toEqual({ firstName: 'required' });
    expect(await err({ lastName: 'К'.repeat(41) })).toEqual({ lastName: 'tooLong' });
    expect(await err({ position: 'Учитель' })).toEqual({ position: 'notAllowed' });
    expect(await err({ about: 'Привет' })).toEqual({ about: 'notAllowed' });
    await as(student)
      .send('patch', '/api/me/profile', { firstName: "O'Нил", lastName: 'Сәрсен-Ұлы' })
      .expect(200);

    const teacher = await newTeacher();
    const saved = await as(teacher)
      .send('patch', '/api/me/profile', { position: 'Учитель биологии', about: 'Веду уроки 10 лет' })
      .expect(200);
    expect(saved.body).toMatchObject({
      position: 'Учитель биологии',
      about: 'Веду уроки 10 лет',
      nameChangesLeft: 3,
    });
    expect(
      (await as(teacher).send('patch', '/api/me/profile', { about: 'Мой сайт: www.example.kz' }).expect(400))
        .body.fieldErrors,
    ).toEqual({ about: 'noLinks' });
    expect(
      (
        await as(teacher)
          .send('patch', '/api/me/profile', { about: 'а'.repeat(301) })
          .expect(400)
      ).body.fieldErrors,
    ).toEqual({ about: 'tooLong' });
    await as(teacher).send('patch', '/api/me/profile', { position: '' }).expect(200);
    expect((await as(teacher).get('/api/me/profile').expect(200)).body.position).toBeNull();
  });

  it('BR-PRF-02 avatar from the set or initials with a colour; a student cannot upload a picture (owner decision 2026-10-25)', async () => {
    const student = await newStudent();
    const preset = (
      await as(student).send('put', '/api/me/avatar', { kind: 'preset', preset: 'owl' }).expect(200)
    ).body;
    expect(preset.avatar).toMatchObject({ kind: 'preset', preset: 'owl' });
    expect((await as(student).get('/api/me').expect(200)).body.avatar.kind).toBe('preset');
    await as(student).send('put', '/api/me/avatar', { kind: 'preset', preset: 'unicorn' }).expect(400);
    await as(student).send('put', '/api/me/avatar', { kind: 'preset' }).expect(400);
    const initials = (
      await as(student).send('put', '/api/me/avatar', { kind: 'initials', color: 'pink' }).expect(200)
    ).body;
    expect(initials.avatar).toMatchObject({ kind: 'initials', color: 'pink', preset: null });
    await as(student).send('put', '/api/me/avatar', { kind: 'initials', color: 'gold' }).expect(400);

    await as(student)
      .send('post', '/api/me/avatar/upload-url', { fileName: 'me.jpg', mime: 'image/jpeg', size: 1000 })
      .expect(403);
    const own = await media(student.userId);
    await as(student).send('put', '/api/me/avatar', { kind: 'photo', mediaId: own.id }).expect(403);
    expect((await as(student).get('/api/me/profile').expect(200)).body.avatar.kind).toBe('initials');
  });

  it('AC-PRF-04 BR-PRF-03 a teacher picture: JPG/PNG/WEBP ≤ 2 MB; initials while it is checked; a signed link once clean; the old picture is deleted', async () => {
    const teacher = await newTeacher();
    const upload = (body: object) => as(teacher).send('post', '/api/me/avatar/upload-url', body);
    expect(
      (await upload({ fileName: 'a.gif', mime: 'image/gif', size: 1000 }).expect(422)).body.fieldErrors,
    ).toEqual({
      mime: 'fileType',
    });
    expect(
      (await upload({ fileName: 'a.jpg', mime: 'image/jpeg', size: 2 * 1_048_576 + 1 }).expect(413)).body
        .fieldErrors,
    ).toEqual({ size: 'fileTooLarge' });
    const issued = (await upload({ fileName: 'Я.jpg', mime: 'image/jpeg', size: 50_000 }).expect(201)).body;
    expect(issued.headers).toEqual({ 'Content-Type': 'image/jpeg' });
    const [row] = await stack.db.select().from(mediaFiles).where(eq(mediaFiles.id, issued.mediaId));
    expect(row).toMatchObject({ kind: 'avatar', ownerId: teacher.userId, scanStatus: 'pending' });
    expect(row!.storageKey).toMatch(/^avatar\//);

    const pending = (
      await as(teacher).send('put', '/api/me/avatar', { kind: 'photo', mediaId: issued.mediaId }).expect(200)
    ).body;
    expect(pending.avatar).toMatchObject({
      kind: 'photo',
      photoUrl: null,
      photoStatus: 'pending',
      initials: 'АН',
    });

    await stack.db.update(mediaFiles).set({ scanStatus: 'clean' }).where(eq(mediaFiles.id, issued.mediaId));
    const clean = (await as(teacher).get('/api/me/profile').expect(200)).body.avatar;
    expect(clean.photoStatus).toBe('clean');
    expect(clean.photoUrl).toContain(row!.storageKey);
    expect(clean.photoUrl).toContain('X-Amz-Signature');
    expect(clean.photoUrlSmall).toContain(`${row!.storageKey}-64`);

    // Новая картинка: прежняя удаляется (запись и оба объекта — задачей worker).
    const next = await media(teacher.userId);
    await as(teacher).send('put', '/api/me/avatar', { kind: 'photo', mediaId: next.id }).expect(200);
    expect(await stack.db.select().from(mediaFiles).where(eq(mediaFiles.id, issued.mediaId))).toHaveLength(0);
    const [deletion] = await stack.db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.type, OUTBOX_EVENT_TYPES.fileDelete),
          sql`${outboxEvents.payload}->'storageKeys' ? ${row!.storageKey}`,
        ),
      );
    expect(deletion!.payload).toEqual({ storageKeys: [row!.storageKey, `${row!.storageKey}-64`] });

    // Отклонённая картинка: «Картинка не прошла проверку» и инициалы.
    await stack.db.update(mediaFiles).set({ scanStatus: 'rejected' }).where(eq(mediaFiles.id, next.id));
    expect((await as(teacher).get('/api/me/profile').expect(200)).body.avatar).toMatchObject({
      kind: 'photo',
      photoStatus: 'rejected',
      photoUrl: null,
    });
    // Отклонённую или чужую картинку выбрать нельзя.
    await as(teacher).send('put', '/api/me/avatar', { kind: 'photo', mediaId: next.id }).expect(404);
    const other = await newTeacher();
    const foreign = await media(other.userId);
    await as(teacher).send('put', '/api/me/avatar', { kind: 'photo', mediaId: foreign.id }).expect(404);
    // Своя картинка не попадает в галерею обложек.
    expect(
      ((await as(teacher).get('/api/teacher/gallery').expect(200)).body as Array<{ id: string }>).map(
        (g) => g.id,
      ),
    ).not.toContain(next.id);
  });

  it('BR-PRF-06 no more than 5 picture uploads in 24 hours', async () => {
    const teacher = await newTeacher();
    for (let i = 0; i < 5; i++) {
      await as(teacher)
        .send('post', '/api/me/avatar/upload-url', { fileName: `${i}.png`, mime: 'image/png', size: 1000 })
        .expect(201);
    }
    const limited = await as(teacher)
      .send('post', '/api/me/avatar/upload-url', { fileName: '6.png', mime: 'image/png', size: 1000 })
      .expect(429);
    expect(limited.body.retryAfterSeconds).toBeGreaterThan(23 * 3600);
  });

  it('AC-PRF-10 BR-PRF-09 only one’s own profile: guest 401, staff 403; no operation takes another user id', async () => {
    await http().get('/api/me/profile').expect(401);
    const support = await login(http, ACCOUNTS.support);
    await as(support).get('/api/me/profile').expect(403);
    await as(support).send('patch', '/api/me/profile', { firstName: 'Сотрудник' }).expect(403);
    // CSRF: без заголовка изменение отклоняется.
    const student = await newStudent();
    await http()
      .patch('/api/me/profile')
      .set('Cookie', student.cookie)
      .send({ firstName: 'Без' })
      .expect(403);
    // Лишние поля (например, userId) не принимаются.
    await as(student)
      .send('patch', '/api/me/profile', { userId: support.userId, firstName: 'Чужой' })
      .expect(400);
    const [profile] = await stack.db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, support.userId));
    expect(profile?.firstName).not.toBe('Чужой');
  });
});
