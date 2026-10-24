import request from 'supertest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { MinioContainer, type StartedMinioContainer } from '@testcontainers/minio';
import { OUTBOX_EVENT_TYPES } from '@syntara/shared';
import { schema } from '@syntara/db';
import { baseIds } from '@syntara/db/seed';
import { ACCOUNTS, freshIp, login, type Session } from './support/session';
import { startStack, type TestStack } from './support/stack';

const BUCKET = 'syntara-delete';
const PDF = Buffer.from('%PDF-1.4\n%test\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const { mediaFiles, outboxEvents, topics, quizzes, questions, answerOptions, topicMaterials, auditLog } =
  schema;

/**
 * docs/DELETE_TZ.md: удаление черновика темы (API-T-30, BR-DEL-01…03), картинки галереи (API-T-31, BR-DEL-04/05),
 * материалы (раздел 4) и оборванные загрузки (раздел 5). Хранилище — настоящий MinIO; объекты удаляет worker по
 * событию file.delete (здесь проверяется событие; удаление объектов — тест worker).
 */
describe('deleting drafts and gallery images (integration, MinIO)', () => {
  let minio: StartedMinioContainer;
  let stack: TestStack;
  let teacher: Session;
  let other: Session;
  const http = () => request(stack.app.getHttpServer());
  const as = (s: Session) => ({
    get: (path: string) => http().get(path).set('Cookie', s.cookie).set('Accept-Language', 'ru'),
    post: (path: string, body: object = {}) =>
      http()
        .post(path)
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', s.csrf)
        .set('X-Forwarded-For', freshIp())
        .send(body),
    put: (path: string, body: object) =>
      http().put(path).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).send(body),
    del: (path: string) => http().delete(path).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf),
  });

  async function newSubject(s: Session = teacher) {
    return (
      await as(s)
        .post('/api/teacher/subjects', { translations: { ru: { title: 'Химия' } }, inPublicCatalog: false })
        .expect(201)
    ).body.id as string;
  }
  const newTopic = async (subjectId: string, s: Session = teacher) =>
    (await as(s).post(`/api/teacher/subjects/${subjectId}/topics`).expect(201)).body.id as string;
  const save = (topicId: string, body: object = {}) =>
    as(teacher)
      .put(`/api/teacher/topics/${topicId}`, {
        translations: { ru: { title: 'Опыты' } },
        materialIds: [],
        ...body,
      })
      .expect(204);
  const addQuestion = (topicId: string) =>
    as(teacher)
      .post(`/api/teacher/topics/${topicId}/quiz/questions`, {
        type: 'single_choice',
        difficulty: 'easy',
        translations: { ru: { text: 'Сколько?' } },
        options: [0, 1].map((i) => ({ translations: { ru: `Ответ ${i}` }, isCorrect: i === 0 })),
      })
      .expect(201);

  /** Загрузка по подписанной ссылке, как в браузере, и API-T-17; проверка worker — отметкой в БД. */
  async function upload(body: object, bytes: Buffer, s: Session = teacher, scan: 'clean' | null = 'clean') {
    const res = await as(s).post('/api/files/upload-url', body).expect(201);
    const put = await fetch(res.body.uploadUrl, {
      method: 'PUT',
      headers: res.body.headers,
      body: new Uint8Array(bytes),
    });
    expect(put.status).toBe(200);
    await as(s).post(`/api/files/${res.body.mediaId}/complete`).expect(200);
    if (scan)
      await stack.db.update(mediaFiles).set({ scanStatus: scan }).where(eq(mediaFiles.id, res.body.mediaId));
    return res.body.mediaId as string;
  }
  const cover = (s: Session = teacher, scan: 'clean' | null = 'clean') =>
    upload({ kind: 'cover', fileName: 'Обложка — 1.png', mime: 'image/png', size: PNG.length }, PNG, s, scan);
  const material = (topicId: string) =>
    upload(
      {
        kind: 'material',
        topicId,
        fileName: 'Конспект урока.pdf',
        mime: 'application/pdf',
        size: PDF.length,
      },
      PDF,
    );
  const media = async (id: string) =>
    (await stack.db.select().from(mediaFiles).where(eq(mediaFiles.id, id)))[0] ?? null;
  /** Ключи из событий file.delete (их выполняет worker после фиксации транзакции). */
  const deletedKeys = async () =>
    (
      await stack.db
        .select({ payload: outboxEvents.payload })
        .from(outboxEvents)
        .where(eq(outboxEvents.type, OUTBOX_EVENT_TYPES.fileDelete))
    ).flatMap((e) => (e.payload as { storageKeys: string[] }).storageKeys);

  beforeAll(async () => {
    minio = await new MinioContainer('cgr.dev/chainguard/minio:latest')
      .withCommand(['server', '--console-address', ':9001', '/home/nonroot/data'])
      .start();
    const s3 = new S3Client({
      endpoint: minio.getConnectionUrl(),
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: minio.getUsername(), secretAccessKey: minio.getPassword() },
    });
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    stack = await startStack('demo', undefined, {
      S3_ENDPOINT: minio.getConnectionUrl(),
      S3_BUCKET: BUCKET,
      S3_ACCESS_KEY: minio.getUsername(),
      S3_SECRET_KEY: minio.getPassword(),
    });
    teacher = await login(http, ACCOUNTS.teacher);
    await http()
      .post('/api/auth/register')
      .set('X-Forwarded-For', freshIp())
      .send({
        role: 'teacher',
        email: 'del.other@example.kz',
        displayName: 'Другой',
        password: 'strong-pass-1',
      })
      .expect(201);
    other = await login(http, 'del.other@example.kz', 'strong-pass-1');
  });

  afterAll(async () => {
    await stack?.stop();
    await minio?.stop();
  });

  it('API-T-30, BR-DEL-01…03, AC-DEL-01/04 a never-published draft is deleted with quiz, questions and materials; numbering has no gaps; the gallery cover stays', async () => {
    const subjectId = await newSubject();
    const first = await newTopic(subjectId);
    const draft = await newTopic(subjectId);
    const third = await newTopic(subjectId);
    await addQuestion(draft);
    const file = await material(draft);
    const coverId = await cover();
    await save(draft, { materialIds: [file], coverMediaId: coverId });
    const key = (await media(file))!.storageKey;
    const [quiz] = await stack.db.select().from(quizzes).where(eq(quizzes.topicId, draft));
    const questionIds = (
      await stack.db.select({ id: questions.id }).from(questions).where(eq(questions.quizId, quiz!.id))
    ).map((q) => q.id);
    expect(questionIds).toHaveLength(1);

    let subject = (await as(teacher).get(`/api/teacher/subjects/${subjectId}`).expect(200)).body;
    expect(subject.topics.map((t: { deletable: boolean }) => t.deletable)).toEqual([true, true, true]);
    expect((await as(teacher).get(`/api/teacher/topics/${draft}`).expect(200)).body.deletable).toBe(true);

    await as(teacher).del(`/api/teacher/topics/${draft}`).expect(204);
    expect(await stack.db.select().from(topics).where(eq(topics.id, draft))).toEqual([]);
    expect(await stack.db.select().from(quizzes).where(eq(quizzes.id, quiz!.id))).toEqual([]);
    expect(
      await stack.db.select().from(answerOptions).where(inArray(answerOptions.questionId, questionIds)),
    ).toEqual([]);
    expect(await stack.db.select().from(topicMaterials).where(eq(topicMaterials.topicId, draft))).toEqual([]);
    expect(await media(file)).toBeNull();
    expect(await deletedKeys()).toContain(key);
    // Обложка — в галерее учителя, не удаляется (BR-DEL-02).
    expect(await media(coverId)).not.toBeNull();
    // BR-DEL-03: «Тема 1», «Тема 2» без пропуска.
    subject = (await as(teacher).get(`/api/teacher/subjects/${subjectId}`).expect(200)).body;
    expect(subject.topics.map((t: { id: string; number: number }) => [t.id, t.number])).toEqual([
      [first, 1],
      [third, 2],
    ]);
    const [audit] = await stack.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, 'topic'), eq(auditLog.entityId, draft)));
    expect(audit).toMatchObject({
      action: 'delete',
      before: expect.objectContaining({ titles: { ru: 'Опыты' } }),
    });
    await as(teacher).del(`/api/teacher/topics/${draft}`).expect(404);
  });

  it('AC-DEL-02/03 a published or once-published topic and a topic with an assignment are not deleted (409)', async () => {
    const subjectId = await newSubject();
    const published = await newTopic(subjectId);
    await save(published);
    await as(teacher).post(`/api/teacher/topics/${published}/publish`).expect(200);
    let res = await as(teacher).del(`/api/teacher/topics/${published}`).expect(409);
    expect(res.body.fieldErrors).toEqual({ topic: 'topicHasHistory' });
    // Снятая с публикации — тоже нельзя: её уже видели ученики.
    await as(teacher).post(`/api/teacher/topics/${published}/unpublish`).expect(200);
    res = await as(teacher).del(`/api/teacher/topics/${published}`).expect(409);
    expect(res.body.fieldErrors).toEqual({ topic: 'topicHasHistory' });
    expect((await as(teacher).get(`/api/teacher/topics/${published}`).expect(200)).body.deletable).toBe(
      false,
    );

    // Задание назначается только по опубликованной теме; черновик с заданием — старые данные (BR-DEL-01).
    const assigned = await newTopic(subjectId);
    const cls = (await as(teacher).post('/api/teacher/classes', { name: 'Удаление' }).expect(201)).body.id;
    await stack.db.execute(sql`
      INSERT INTO assignments (id, class_id, subject_id, topic_id, due_at, created_by)
      VALUES (gen_random_uuid(), ${cls}, ${subjectId}, ${assigned}, now() + interval '1 day',
              (SELECT teacher_id FROM classes WHERE id = ${cls}))`);
    res = await as(teacher).del(`/api/teacher/topics/${assigned}`).expect(409);
    expect(res.body.fieldErrors).toEqual({ topic: 'topicHasAssignments' });
    const list = (await as(teacher).get(`/api/teacher/subjects/${subjectId}`).expect(200)).body.topics;
    expect(list.map((t: { deletable: boolean }) => t.deletable)).toEqual([false, false]);
  });

  it('AC-DEL-07 another teacher gets 404 for a topic and a gallery image; a base topic is 404', async () => {
    const subjectId = await newSubject();
    const draft = await newTopic(subjectId);
    const image = await cover();
    await as(other).del(`/api/teacher/topics/${draft}`).expect(404);
    await as(other).del(`/api/teacher/gallery/${image}`).expect(404);
    const B = await baseIds(stack.db);
    await as(teacher).del(`/api/teacher/topics/${B.topicCardio}`).expect(404);
    await http().delete(`/api/teacher/topics/${draft}`).expect(401);
    expect(await media(image)).not.toBeNull();
  });

  it('API-T-31, BR-DEL-04/05, AC-DEL-05/06 gallery: any status is deleted; a cover of a draft, of a published version or of a Battle question is in use (409)', async () => {
    // Свободные картинки — в любом статусе, включая «Проверяется».
    const free = await cover();
    const checking = await cover(teacher, null);
    expect((await media(checking))!.scanStatus).toBe('pending');
    for (const id of [free, checking]) {
      const key = (await media(id))!.storageKey;
      await as(teacher).del(`/api/teacher/gallery/${id}`).expect(204);
      expect(await media(id)).toBeNull();
      expect(await deletedKeys()).toContain(key);
    }
    const [audit] = await stack.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, 'media_file'), eq(auditLog.entityId, free)));
    expect(audit).toMatchObject({ action: 'delete' });

    // Обложка черновика.
    const subjectId = await newSubject();
    const topic = await newTopic(subjectId);
    const used = await cover();
    await save(topic, { coverMediaId: used });
    let res = await as(teacher).del(`/api/teacher/gallery/${used}`).expect(409);
    expect(res.body.fieldErrors).toEqual({ media: 'coverInUse' });
    let gallery = (await as(teacher).get('/api/teacher/gallery').expect(200)).body;
    expect(gallery.find((g: { id: string }) => g.id === used).usedIn).toEqual({
      kind: 'topic',
      title: 'Опыты',
    });

    // Обложка только в опубликованной версии (в черновике уже другая или убрана) — тоже используется.
    await as(teacher).post(`/api/teacher/topics/${topic}/publish`).expect(200);
    await save(topic, { coverMediaId: null });
    res = await as(teacher).del(`/api/teacher/gallery/${used}`).expect(409);
    expect(res.body.fieldErrors).toEqual({ media: 'coverInUse' });

    // Картинка вопроса Battle.
    const battleImage = await cover();
    const battle = (
      await as(teacher).post('/api/teacher/battles', { title: 'Опыты', locale: 'ru' }).expect(201)
    ).body.id;
    await as(teacher)
      .post(`/api/teacher/battles/${battle}/questions`, {
        type: 'single_choice',
        text: 'Что это?',
        imageMediaId: battleImage,
        timeLimitSec: 20,
        options: ['Колба', 'Пробирка'].map((text, i) => ({ text, isCorrect: i === 0 })),
      })
      .expect(201);
    res = await as(teacher).del(`/api/teacher/gallery/${battleImage}`).expect(409);
    expect(res.body.fieldErrors).toEqual({ media: 'coverInUseBattle' });
    gallery = (await as(teacher).get('/api/teacher/gallery').expect(200)).body;
    expect(gallery.find((g: { id: string }) => g.id === battleImage).usedIn).toEqual({
      kind: 'battle',
      title: 'Опыты',
    });
  });

  it('BR-DEL-02 deleting a draft keeps Battle questions copied from its quiz (only the source link is cleared)', async () => {
    const subjectId = await newSubject();
    const draft = await newTopic(subjectId);
    await save(draft);
    await addQuestion(draft);
    const battle = (
      await as(teacher).post('/api/teacher/battles', { title: 'Копия', locale: 'ru' }).expect(201)
    ).body.id;
    await as(teacher).post(`/api/teacher/battles/${battle}/import`, { topicId: draft }).expect(200);
    await as(teacher).del(`/api/teacher/topics/${draft}`).expect(204);
    const copied = await stack.db
      .select()
      .from(schema.battleQuestions)
      .where(eq(schema.battleQuestions.battleQuizId, battle));
    expect(copied).toHaveLength(1);
    expect(copied[0]!.sourceQuestionId).toBeNull();
  });

  it('DELETE_TZ 4: a material removed with «✕» is deleted with its object; one in a published version is kept for students', async () => {
    const subjectId = await newSubject();
    const topic = await newTopic(subjectId);
    const kept = await material(topic);
    const dropped = await material(topic);
    await save(topic, { materialIds: [kept, dropped] });
    // Убран до публикации — запись и объект удаляются.
    const droppedKey = (await media(dropped))!.storageKey;
    await save(topic, { materialIds: [kept] });
    expect(await media(dropped)).toBeNull();
    expect(await deletedKeys()).toContain(droppedKey);
    // Опубликован, затем убран из черновика — остаётся: его видят ученики, пока тема не опубликована заново.
    await as(teacher).post(`/api/teacher/topics/${topic}/publish`).expect(200);
    await save(topic, { materialIds: [] });
    expect(await media(kept)).not.toBeNull();
  });

  it('DELETE_TZ 5, AC-DEL-09 an abandoned upload (link issued, never completed) is not shown as «Проверяется»', async () => {
    const subjectId = await newSubject();
    const topic = await newTopic(subjectId);
    const abandonedCover = (
      await as(teacher)
        .post('/api/files/upload-url', {
          kind: 'cover',
          fileName: 'oops.png',
          mime: 'image/png',
          size: PNG.length,
        })
        .expect(201)
    ).body.mediaId;
    const abandonedMaterial = (
      await as(teacher)
        .post('/api/files/upload-url', {
          kind: 'material',
          topicId: topic,
          fileName: 'oops.pdf',
          mime: 'application/pdf',
          size: PDF.length,
        })
        .expect(201)
    ).body.mediaId;
    const checking = await cover(teacher, null);
    const gallery = (await as(teacher).get('/api/teacher/gallery').expect(200)).body.map(
      (g: { id: string }) => g.id,
    );
    expect(gallery).not.toContain(abandonedCover);
    expect(gallery).toContain(checking);
    const detail = (await as(teacher).get(`/api/teacher/topics/${topic}`).expect(200)).body;
    expect(detail.materials.map((m: { id: string }) => m.id)).not.toContain(abandonedMaterial);
  });
});
