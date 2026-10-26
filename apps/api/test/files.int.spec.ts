import request from 'supertest';
import { eq } from 'drizzle-orm';
import { CreateBucketCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { MinioContainer, type StartedMinioContainer } from '@testcontainers/minio';
import { FILE_LIMITS, OUTBOX_EVENT_TYPES } from '@syntara/shared';
import { schema } from '@syntara/db';
import { ACCOUNTS, freshIp, login, type Session } from './support/session';
import { startStack, type TestStack } from './support/stack';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { REMOTE_ADDRESS_POLICY } from '../src/modules/files/remote-image';

const BUCKET = 'syntara-test';
const MB = 1_048_576;
const PDF = Buffer.from('%PDF-1.4\n%test\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

/** Минимальный ZIP (метод stored; CRC разбором не проверяется) — фикстуры DOCX/PPTX/ODT и книги Excel. */
function makeZip(entries: Record<string, string>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content);
    const nameBuf = Buffer.from(name);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    local.push(header, nameBuf, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const count = Object.keys(entries).length;
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
/** BR-FILE-09: книга Excel (OOXML). */
const XLSX = makeZip({ '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': '<workbook/>' });
const SPREADSHEETS: Array<[string, string]> = [
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['xls', 'application/vnd.ms-excel'],
  ['xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12'],
  ['xlsb', 'application/vnd.ms-excel.sheet.binary.macroEnabled.12'],
  ['csv', 'text/csv'],
  ['ods', 'application/vnd.oasis.opendocument.spreadsheet'],
];

/** Итерация 7: файлы (7.8, SM-FILE) на настоящем S3-совместимом хранилище (MinIO). */
describe('files (integration, MinIO)', () => {
  let minio: StartedMinioContainer;
  let s3: S3Client;
  let stack: TestStack;
  let teacher: Session;
  let otherTeacher: Session;
  let topicId: string;
  let imageServer: Server;
  let imageBase: string;
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
    // Сайт с картинкой для BR-FILE-06 — локальный, поэтому политика адресов в этом тесте разрешает loopback
    // (сама защита от SSRF проверяется в remote-image.spec.ts).
    imageServer = createServer((req, res) => {
      if (req.url === '/heart.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(PNG);
      } else if (req.url === '/marks.xlsx') {
        res.writeHead(200, { 'Content-Type': SPREADSHEETS[0]![1] });
        res.end(XLSX);
      } else if (req.url === '/table.png') {
        // Книга Excel, выданная сервером как картинка.
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(XLSX);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => imageServer.listen(0, '127.0.0.1', resolve));
    imageBase = `http://127.0.0.1:${(imageServer.address() as AddressInfo).port}`;
    stack = await startStack(
      'demo',
      (b) =>
        b
          .overrideProvider(REMOTE_ADDRESS_POLICY)
          .useValue({ allowAddress: () => true, allowPort: () => true }),
      {
        S3_ENDPOINT: minio.getConnectionUrl(),
        S3_BUCKET: BUCKET,
        S3_ACCESS_KEY: minio.getUsername(),
        S3_SECRET_KEY: minio.getPassword(),
      },
    );
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
    imageServer?.close();
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
      formatNotSupported: false,
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
    // Загрузка подтверждена (API-T-17) и ждёт проверки — «Проверяется»; неподтверждённая не показывается.
    await post(teacher, `/api/files/${pending}/complete`).expect(200);
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
    await post(teacher, `/api/files/${pendingId}/complete`).expect(200);
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

  it('BR-FILE-06 a cover link is downloaded into our storage; the student gets our signed link, not the external one', async () => {
    const topic = await newTopic(teacher, true);
    const coverUrl = `${imageBase}/heart.png`;
    const save = (url: string) =>
      http()
        .put(`/api/teacher/topics/${topic}`)
        .set('Cookie', teacher.cookie)
        .set('X-CSRF-Token', teacher.csrf)
        .send({ translations: { ru: { title: 'Обложка по ссылке' } }, coverUrl: url, materialIds: [] });
    await save(coverUrl).expect(204);

    const saved = await get(teacher, `/api/teacher/topics/${topic}`).expect(200);
    expect(saved.body.coverUrl).toBe(coverUrl);
    const cover = await media(saved.body.coverMediaId);
    expect(cover).toMatchObject({
      kind: 'cover',
      mime: 'image/png',
      sizeBytes: PNG.length,
      scanStatus: 'pending',
    });
    expect(await exists(cover.storageKey)).toBe(true);
    // Та же проверка, что у загруженных файлов (BR-FILE-03): событие file.scan.
    const events = (await stack.db.select().from(schema.outboxEvents)).filter(
      (e) =>
        e.type === OUTBOX_EVENT_TYPES.fileScan && (e.payload as { mediaId: string }).mediaId === cover.id,
    );
    expect(events).toHaveLength(1);
    // Пока файл не проверен, обложки нет ни в предпросмотре, ни у ученика.
    expect(saved.body.coverPreviewUrl).toBeNull();

    // Повторное сохранение той же ссылки не скачивает картинку заново.
    await save(coverUrl).expect(204);
    expect((await get(teacher, `/api/teacher/topics/${topic}`)).body.coverMediaId).toBe(cover.id);

    await stack.db
      .update(schema.mediaFiles)
      .set({ scanStatus: 'clean' })
      .where(eq(schema.mediaFiles.id, cover.id));
    await post(teacher, `/api/teacher/topics/${topic}/publish`).expect(200);
    const student = await login(http, 'files.student', 'student-pass-1');
    const lesson = await get(student, `/api/student/topics/${topic}`).expect(200);
    expect(lesson.body.illustrationUrl).toContain(minio.getConnectionUrl());
    expect(lesson.body.illustrationUrl).toContain('X-Amz-Expires=600');
    expect(lesson.body.illustrationUrl).not.toContain(imageBase);

    // Не удалось скачать — понятная ошибка учителю, тема не меняется.
    const failed = await save(`${imageBase}/missing.png`).expect(422);
    expect(failed.body.fieldErrors).toEqual({ coverUrl: 'coverDownload' });
    expect((await get(teacher, `/api/teacher/topics/${topic}`)).body.coverMediaId).toBe(cover.id);
  });

  describe('BR-FILE-09 spreadsheets are not uploaded anywhere', () => {
    const notAllowed = { code: 'UNPROCESSABLE', fieldErrors: { file: 'fileTypeNotAllowed' } };

    it.each(SPREADSHEETS)(
      'BR-FILE-09 .%s is refused before an upload link: material, cover (Battle image) and avatar',
      async (ext, mime) => {
        const before = (await stack.db.select().from(schema.mediaFiles)).length;
        const asMaterial = await post(
          teacher,
          '/api/files/upload-url',
          material({ fileName: `Оценки.${ext}`, mime }),
        ).expect(422);
        expect(asMaterial.body).toMatchObject(notAllowed);
        expect(asMaterial.body.uploadUrl).toBeUndefined();
        const asCover = await post(teacher, '/api/files/upload-url', {
          kind: 'cover',
          fileName: `table.${ext}`,
          mime,
          size: 100,
        }).expect(422);
        expect(asCover.body).toMatchObject(notAllowed);
        const asAvatar = await post(teacher, '/api/me/avatar/upload-url', {
          fileName: `me.${ext}`,
          mime,
          size: 100,
        }).expect(422);
        expect(asAvatar.body).toMatchObject(notAllowed);
        expect((await stack.db.select().from(schema.mediaFiles)).length).toBe(before);
      },
    );

    it('BR-FILE-09 a spreadsheet MIME under an allowed extension (CSV as .txt) is refused', async () => {
      const res = await post(
        teacher,
        '/api/files/upload-url',
        material({ fileName: 'notes.txt', mime: 'text/csv' }),
      ).expect(422);
      expect(res.body).toMatchObject(notAllowed);
    });

    it('BR-FILE-09 an xlsx renamed to .docx is refused on upload confirmation: rejected, object deleted', async () => {
      const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const id = await upload(
        material({ fileName: 'Конспект.docx', mime: docxMime, size: XLSX.length }),
        XLSX,
      );
      const res = await post(teacher, `/api/files/${id}/complete`).expect(422);
      expect(res.body).toMatchObject(notAllowed);
      const row = await media(id);
      expect(row.scanStatus).toBe('rejected');
      expect(await exists(row.storageKey)).toBe(false);
      // Картинка Battle или обложка с книгой Excel внутри — то же.
      const cover = await upload(
        { kind: 'cover', fileName: 'q.png', mime: 'image/png', size: XLSX.length },
        XLSX,
      );
      const coverRes = await post(teacher, `/api/files/${cover}/complete`).expect(422);
      expect(coverRes.body).toMatchObject(notAllowed);
    });

    it('BR-FILE-09 a cover link to a spreadsheet is refused (by type and by content)', async () => {
      const topic = await newTopic(teacher);
      for (const path of ['/marks.xlsx', '/table.png']) {
        const res = await http()
          .put(`/api/teacher/topics/${topic}`)
          .set('Cookie', teacher.cookie)
          .set('X-CSRF-Token', teacher.csrf)
          .send({ translations: { ru: { title: 'Ссылка' } }, coverUrl: imageBase + path, materialIds: [] })
          .expect(422);
        expect(res.body.fieldErrors).toEqual({ coverUrl: 'fileTypeNotAllowed' });
      }
    });

    it('BR-FILE-02 PDF, DOCX, PPTX, ODT and TXT are uploaded as before', async () => {
      const topic = await newTopic(teacher);
      const files: Array<[string, string, Buffer]> = [
        ['a.pdf', 'application/pdf', PDF],
        [
          'a.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          makeZip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document/>' }),
        ],
        [
          'a.pptx',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          makeZip({ '[Content_Types].xml': '<Types/>', 'ppt/presentation.xml': '<p/>' }),
        ],
        [
          'a.odt',
          'application/vnd.oasis.opendocument.text',
          makeZip({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': '<office/>' }),
        ],
        ['a.txt', 'text/plain', Buffer.from('Текст урока: 1, 2, 3')],
      ];
      for (const [fileName, mime, bytes] of files) {
        const id = await upload(material({ topicId: topic, fileName, mime, size: bytes.length }), bytes);
        const done = await post(teacher, `/api/files/${id}/complete`).expect(200);
        expect(done.body).toEqual({ id, scanStatus: 'pending', url: null });
      }
    });

    it('BR-FILE-09 a spreadsheet uploaded before the ban is not given to students; the teacher sees «format not supported»', async () => {
      const topic = await newTopic(teacher, true);
      const pdfId = await upload(material({ topicId: topic, fileName: 'ok.pdf' }), PDF);
      // Файл, загруженный до запрета: проверен (clean), объект в хранилище остаётся.
      const [legacy] = await stack.db
        .insert(schema.mediaFiles)
        .values({
          ownerId: (await media(pdfId)).ownerId,
          kind: 'material',
          originalName: 'Оценки.xlsx',
          mime: SPREADSHEETS[0]![1],
          sizeBytes: XLSX.length,
          storageKey: `material/${crypto.randomUUID()}`,
          scanStatus: 'clean',
        })
        .returning();
      await stack.db
        .update(schema.mediaFiles)
        .set({ scanStatus: 'clean' })
        .where(eq(schema.mediaFiles.id, pdfId));
      await http()
        .put(`/api/teacher/topics/${topic}`)
        .set('Cookie', teacher.cookie)
        .set('X-CSRF-Token', teacher.csrf)
        .send({ translations: { ru: { title: 'Старая таблица' } }, materialIds: [pdfId, legacy!.id] })
        .expect(204);
      await post(teacher, `/api/teacher/topics/${topic}/publish`).expect(200);

      const student = await login(http, 'files.student', 'student-pass-1');
      const lesson = await get(student, `/api/student/topics/${topic}`).expect(200);
      expect(lesson.body.materials.map((m: { id: string }) => m.id)).toEqual([pdfId]);
      expect(JSON.stringify(lesson.body)).not.toContain(legacy!.storageKey);

      const teacherView = await get(teacher, `/api/teacher/topics/${topic}`).expect(200);
      expect(
        teacherView.body.materials.map((m: { id: string; formatNotSupported: boolean }) => [
          m.id,
          m.formatNotSupported,
        ]),
      ).toEqual([
        [pdfId, false],
        [legacy!.id, true],
      ]);
      // Автоматически не удаляется: учитель убирает «✕» и сохраняет.
      expect((await media(legacy!.id)).scanStatus).toBe('clean');
    });
  });
});
