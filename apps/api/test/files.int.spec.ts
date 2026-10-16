import request from 'supertest';
import { eq } from 'drizzle-orm';
import { CreateBucketCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { MinioContainer, type StartedMinioContainer } from '@testcontainers/minio';
import { FILE_LIMITS, OUTBOX_EVENT_TYPES } from '@syntara/shared';
import { schema } from '@syntara/db';
import { ACCOUNTS, freshIp, login, type Session } from './support/session';
import { startStack, type TestStack } from './support/stack';

const BUCKET = 'syntara-test';
const MB = 1_048_576;
const PDF = Buffer.from('%PDF-1.4\n%test\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

/** Итерация 7: файлы (7.8, SM-FILE) на настоящем S3-совместимом хранилище (MinIO). */
describe('files (integration, MinIO)', () => {
  let minio: StartedMinioContainer;
  let s3: S3Client;
  let stack: TestStack;
  let teacher: Session;
  let otherTeacher: Session;
  let topicId: string;
  const http = () => request(stack.app.getHttpServer());
  const post = (s: Session, path: string, body: object = {}) =>
    http()
      .post(path)
      .set('Cookie', s.cookie)
      .set('X-CSRF-Token', s.csrf)
      .set('X-Forwarded-For', freshIp())
      .send(body);
  const get = (s: Session, path: string) => http().get(path).set('Cookie', s.cookie);

  const material = (extra: object = {}) => ({
    kind: 'material',
    topicId,
    fileName: 'Конспект.pdf',
    mime: 'application/pdf',
    size: PDF.length,
    ...extra,
  });

  /** Загрузка по подписанной ссылке так же, как это делает браузер. */
  async function upload(body: object, bytes: Buffer): Promise<string> {
    const res = await post(teacher, '/api/files/upload-url', body).expect(201);
    const put = await fetch(res.body.uploadUrl, {
      method: 'PUT',
      headers: res.body.headers,
      body: new Uint8Array(bytes),
    });
    expect(put.status).toBe(200);
    return res.body.mediaId as string;
  }

  const media = async (id: string) =>
    (await stack.db.select().from(schema.mediaFiles).where(eq(schema.mediaFiles.id, id)))[0]!;
  const exists = async (key: string) => {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      return true;
    } catch {
      return false;
    }
  };

  async function newTopic(s: Session, inPublicCatalog = false): Promise<string> {
    const subject = await post(s, '/api/teacher/subjects', {
      translations: { ru: { title: 'Файлы' } },
      inPublicCatalog,
    }).expect(201);
    const topic = await post(s, `/api/teacher/subjects/${subject.body.id}/topics`).expect(201);
    return topic.body.id;
  }

  beforeAll(async () => {
    minio = await new MinioContainer('cgr.dev/chainguard/minio:latest')
      .withCommand(['server', '--console-address', ':9001', '/home/nonroot/data'])
      .start();
    s3 = new S3Client({
      endpoint: minio.getConnectionUrl(),
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: minio.getUsername(), secretAccessKey: minio.getPassword() },
    });
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    stack = await startStack('demo', (b) => b, {
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
        email: 'files.other@example.kz',
        displayName: 'Другой',
        password: 'strong-pass-1',
      })
      .expect(201);
    otherTeacher = await login(http, 'files.other@example.kz', 'strong-pass-1');
    topicId = await newTopic(teacher);
  });

  afterAll(async () => {
    await stack?.stop();
    await minio?.stop();
  });

  it('BR-FILE-01 cover: only JPG/PNG/WEBP/GIF up to 5 MB — checked before the upload link is issued', async () => {
    const type = await post(teacher, '/api/files/upload-url', {
      kind: 'cover',
      fileName: 'a.svg',
      mime: 'image/svg+xml',
      size: 100,
    }).expect(422);
    expect(type.body.fieldErrors).toEqual({ mime: 'fileType' });
    const big = await post(teacher, '/api/files/upload-url', {
      kind: 'cover',
      fileName: 'a.png',
      mime: 'image/png',
      size: FILE_LIMITS.coverMaxBytes + 1,
    }).expect(413);
    expect(big.body.fieldErrors).toEqual({ size: 'fileTooLarge' });
    const ok = await post(teacher, '/api/files/upload-url', {
      kind: 'cover',
      fileName: 'a.png',
      mime: 'image/png',
      size: 5 * MB,
    }).expect(201);
    expect(ok.body).toEqual({
      mediaId: expect.any(String),
      uploadUrl: expect.stringContaining(minio.getConnectionUrl()),
      headers: { 'Content-Type': 'image/png' },
    });
  });

  it('BR-FILE-02 material: allowed extensions and MIME, up to 25 MB, own topic only', async () => {
    const exe = await post(teacher, '/api/files/upload-url', material({ fileName: 'a.exe' })).expect(422);
    expect(exe.body.fieldErrors).toEqual({ mime: 'fileType' });
    await post(teacher, '/api/files/upload-url', material({ fileName: 'a.docx' })).expect(422);
    const big = await post(teacher, '/api/files/upload-url', material({ size: 25 * MB + 1 })).expect(413);
    expect(big.body.fieldErrors).toEqual({ size: 'fileTooLarge' });
    const noTopic = await post(teacher, '/api/files/upload-url', material({ topicId: undefined })).expect(
      400,
    );
    expect(noTopic.body.fieldErrors).toEqual({ topicId: 'required' });
    await post(otherTeacher, '/api/files/upload-url', material()).expect(404);
  });

  it('AC-TCH-06 with 20 materials the 21st is refused (422) before an upload link is issued', async () => {
    const topic = await newTopic(teacher);
    for (let i = 0; i < 20; i++) {
      await post(teacher, '/api/files/upload-url', material({ topicId: topic, fileName: `${i}.pdf` })).expect(
        201,
      );
    }
    const before = (await stack.db.select().from(schema.mediaFiles)).length;
    const res = await post(teacher, '/api/files/upload-url', material({ topicId: topic })).expect(422);
    expect(res.body).toMatchObject({ code: 'UNPROCESSABLE', fieldErrors: { file: 'tooManyFiles' } });
    expect(res.body.uploadUrl).toBeUndefined();
    expect((await stack.db.select().from(schema.mediaFiles)).length).toBe(before);
  });

  it('BR-FILE-02 no more than 200 MB per topic → 413', async () => {
    const topic = await newTopic(teacher);
    for (let i = 0; i < 8; i++) {
      await post(teacher, '/api/files/upload-url', material({ topicId: topic, size: 25 * MB })).expect(201);
    }
    const res = await post(teacher, '/api/files/upload-url', material({ topicId: topic, size: 1 })).expect(
      413,
    );
    expect(res.body.fieldErrors).toEqual({ size: 'topicTooLarge' });
  });

  it('API-T-17, SM-FILE a valid upload stays pending and is queued for scanning exactly once', async () => {
    const id = await upload(material(), PDF);
    const first = await post(teacher, `/api/files/${id}/complete`).expect(200);
    expect(first.body).toEqual({ id, scanStatus: 'pending', url: null });
    await post(teacher, `/api/files/${id}/complete`).expect(200);
    const events = (await stack.db.select().from(schema.outboxEvents)).filter(
      (e) => e.type === OUTBOX_EVENT_TYPES.fileScan && (e.payload as { mediaId: string }).mediaId === id,
    );
    expect(events).toHaveLength(1);
    // Материал сразу в списке темы со статусом «Проверяется».
    const topic = await get(teacher, `/api/teacher/topics/${topicId}`).expect(200);
    expect(topic.body.materials).toContainEqual({
      id,
      name: 'Конспект.pdf',
      mime: 'application/pdf',
      size: PDF.length,
      scanStatus: 'pending',
      url: null,
    });
  });

  it('BR-FILE-02 signature mismatch after upload → 422, rejected, object deleted', async () => {
    const id = await upload(material({ size: 11 }), Buffer.from('not a pdf!!'));
    const res = await post(teacher, `/api/files/${id}/complete`).expect(422);
    expect(res.body.fieldErrors).toEqual({ file: 'fileSignature' });
    const row = await media(id);
    expect(row.scanStatus).toBe('rejected');
    expect(await exists(row.storageKey)).toBe(false);
  });

  it('API-T-17 the real size is re-checked after upload (declared smaller than uploaded)', async () => {
    const id = await upload(
      { kind: 'cover', fileName: 'big.png', mime: 'image/png', size: 10 },
      Buffer.concat([PNG, Buffer.alloc(5 * MB)]),
    );
    const res = await post(teacher, `/api/files/${id}/complete`).expect(413);
    expect(res.body.fieldErrors).toEqual({ size: 'fileTooLarge' });
    expect((await media(id)).scanStatus).toBe('rejected');
  });

  it('API-T-17 completing without an uploaded object → 422 fileMissing; foreign media → 404', async () => {
    const res = await post(teacher, '/api/files/upload-url', material()).expect(201);
    const missing = await post(teacher, `/api/files/${res.body.mediaId}/complete`).expect(422);
    expect(missing.body.fieldErrors).toEqual({ file: 'fileMissing' });
    await post(otherTeacher, `/api/files/${res.body.mediaId}/complete`).expect(404);
  });

  it('API-T-18, BR-FILE-05 the gallery lists own covers; thumbnails only after the scan', async () => {
    const clean = await upload(
      { kind: 'cover', fileName: 'clean.png', mime: 'image/png', size: PNG.length },
      PNG,
    );
    const pending = await upload(
      { kind: 'cover', fileName: 'pending.png', mime: 'image/png', size: PNG.length },
      PNG,
    );
    await stack.db
      .update(schema.mediaFiles)
      .set({ scanStatus: 'clean' })
      .where(eq(schema.mediaFiles.id, clean));
    const gallery = await get(teacher, '/api/teacher/gallery').expect(200);
    const byId = Object.fromEntries(gallery.body.map((g: { id: string }) => [g.id, g]));
    expect(byId[clean]).toMatchObject({
      name: 'clean.png',
      scanStatus: 'clean',
      url: expect.stringContaining('X-Amz-Expires=600'),
    });
    expect(byId[pending]).toMatchObject({ scanStatus: 'pending', url: null });
    expect((await get(otherTeacher, '/api/teacher/gallery').expect(200)).body).toEqual([]);
  });

  it('AC-TCH-05, BR-FILE-04 students get only clean materials, by a 10-minute signed link', async () => {
    const topic = await newTopic(teacher, true);
    const cleanId = await upload(material({ topicId: topic, fileName: 'ok.pdf' }), PDF);
    const rejectedId = await upload(material({ topicId: topic, fileName: 'macro.pdf' }), PDF);
    const pendingId = await upload(material({ topicId: topic, fileName: 'wait.pdf' }), PDF);
    await stack.db
      .update(schema.mediaFiles)
      .set({ scanStatus: 'clean' })
      .where(eq(schema.mediaFiles.id, cleanId));
    await stack.db
      .update(schema.mediaFiles)
      .set({ scanStatus: 'rejected' })
      .where(eq(schema.mediaFiles.id, rejectedId));
    await http()
      .put(`/api/teacher/topics/${topic}`)
      .set('Cookie', teacher.cookie)
      .set('X-CSRF-Token', teacher.csrf)
      .send({ translations: { ru: { title: 'С файлами' } }, materialIds: [cleanId, rejectedId, pendingId] })
      .expect(204);
    await post(teacher, `/api/teacher/topics/${topic}/publish`).expect(200);

    const cls = await post(teacher, '/api/teacher/classes', { name: 'Файлы' }).expect(201);
    const code = await post(teacher, `/api/teacher/classes/${cls.body.id}/invite-codes`).expect(201);
    await http()
      .post('/api/auth/register-student')
      .set('X-Forwarded-For', freshIp())
      .send({
        code: code.body.code,
        displayName: 'Ученик',
        login: 'files.student',
        password: 'student-pass-1',
      })
      .expect(201);
    const student = await login(http, 'files.student', 'student-pass-1');
    const lesson = await get(student, `/api/student/topics/${topic}`).expect(200);
    expect(lesson.body.materials).toEqual([
      { id: cleanId, name: 'ok.pdf', url: expect.stringContaining('X-Amz-Expires=600') },
    ]);
    // Ссылка рабочая: файл скачивается.
    const file = await fetch(lesson.body.materials[0].url);
    expect(Buffer.from(await file.arrayBuffer())).toEqual(PDF);
    // Учитель видит статусы всех материалов.
    const teacherView = await get(teacher, `/api/teacher/topics/${topic}`).expect(200);
    expect(teacherView.body.materials.map((m: { scanStatus: string }) => m.scanStatus)).toEqual([
      'clean',
      'rejected',
      'pending',
    ]);
  });
});
