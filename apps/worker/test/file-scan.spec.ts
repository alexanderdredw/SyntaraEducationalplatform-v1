import { createServer, type Server } from 'node:net';
import { crc32 } from 'node:zlib';
import { type Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import pino from 'pino';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { OUTBOX_EVENT_TYPES } from '@syntara/shared';
import { createDb, type Database, schema } from '@syntara/db';
import { migrateUp } from '@syntara/db/migrator';
import { runSeed } from '@syntara/db/seed';
import { DEMO_IDS } from '@syntara/db/seed';
import sharp from 'sharp';
import {
  deleteObjects,
  FILE_SCAN_JOB_OPTIONS,
  hasMacroParts,
  scanFile,
  zipEntryNames,
} from '../src/processors/file-scan';
import { abandonStaleAttempts, cleanupStaleUploads, requeueStuckScans } from '../src/processors/maintenance';
import { processOutbox } from '../src/processors/outbox';
import { clamdScan, type Scanners } from '../src/processors/scanners';

/** Минимальный ZIP (метод stored) — основа фикстур DOCX. */
function makeZip(entries: Record<string, string>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content);
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    local.push(header, nameBuf, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

const DOCX = {
  '[Content_Types].xml': '<Types/>',
  'word/document.xml': '<w:document>Visual Basic/ в тексте — не макрос</w:document>',
};
/** Фикстура AC-TCH-05: DOCX с проектом макросов. */
const MACRO_DOCX = makeZip({ ...DOCX, 'word/vbaProject.bin': 'Attribute VB_Name = "Module1"' });
const CLEAN_DOCX = makeZip(DOCX);
/** Стандартный тестовый файл EICAR (не вредоносный); в base64 — чтобы антивирус машины не трогал сам тест. */
const EICAR = Buffer.from(
  'WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=',
  'base64',
);

/** Сервер с протоколом clamd INSTREAM: находит EICAR, как настоящий ClamAV. */
function fakeClamd(): Promise<{ server: Server; host: string }> {
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      let buf = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        const command = Buffer.from('zINSTREAM\0');
        if (buf.length < command.length) return;
        let p = command.length;
        const data: Buffer[] = [];
        while (p + 4 <= buf.length) {
          const size = buf.readUInt32BE(p);
          if (size === 0) {
            const body = Buffer.concat(data);
            socket.end(body.includes(EICAR) ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
            return;
          }
          if (p + 4 + size > buf.length) return;
          data.push(buf.subarray(p + 4, p + 4 + size));
          p += 4 + size;
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number };
      resolve({ server, host: `127.0.0.1:${address.port}` });
    });
  });
}

describe('worker file-scan (BR-FILE-03, SM-FILE)', () => {
  let pg: StartedPostgreSqlContainer;
  let db: Database;
  let clamd: { server: Server; host: string };
  const objects = new Map<string, Buffer>();
  const removed: string[] = [];
  const storage = {
    read: async (key: string) => objects.get(key)!,
    put: async (key: string, data: Buffer) => {
      objects.set(key, data);
    },
    remove: async (key: string) => {
      removed.push(key);
      objects.delete(key);
    },
  };
  const lines: string[] = [];
  const logger = pino({}, { write: (line: string) => lines.push(line) });
  let olevbaMacros = false;
  const scanners = (): Scanners => ({
    antivirus: (data) => clamdScan(clamd.host, data),
    macros: async () => ({ macros: olevbaMacros }),
  });

  async function pending(
    name: string,
    data: Buffer,
    kind: 'material' | 'cover' | 'avatar' = 'material',
  ): Promise<string> {
    const key = `${kind}/${crypto.randomUUID()}`;
    objects.set(key, data);
    const [row] = await db
      .insert(schema.mediaFiles)
      .values({
        ownerId: DEMO_IDS.teacher,
        kind,
        originalName: name,
        mime: 'x',
        sizeBytes: data.length,
        storageKey: key,
      })
      .returning();
    return row!.id;
  }
  const status = async (id: string) =>
    (await db.select().from(schema.mediaFiles).where(eq(schema.mediaFiles.id, id)))[0]!;
  const scan = (mediaId: string) =>
    scanFile({ data: { mediaId } }, { db, storage, scanners: scanners(), logger });

  beforeAll(async () => {
    pg = await new PostgreSqlContainer('postgres:16-alpine').start();
    db = createDb(pg.getConnectionUri(), { max: 2 });
    await migrateUp(db);
    await runSeed(db, 'demo');
    clamd = await fakeClamd();
  });

  afterAll(async () => {
    clamd?.server.close();
    await db?.$client.end();
    await pg?.stop();
  });

  beforeEach(() => {
    olevbaMacros = false;
  });

  it('BR-FILE-03 ZIP entries are read from the central directory; text mentioning «Basic/» is not a macro', () => {
    expect(zipEntryNames(MACRO_DOCX)).toContain('word/vbaProject.bin');
    expect(hasMacroParts(MACRO_DOCX)).toBe(true);
    expect(hasMacroParts(CLEAN_DOCX)).toBe(false);
    expect(
      hasMacroParts(
        makeZip({ mimetype: 'application/vnd.oasis.opendocument.text', 'Basic/Standard/Module1.xml': '' }),
      ),
    ).toBe(true);
    expect(zipEntryNames(Buffer.from('%PDF-1.4'))).toEqual([]);
  });

  it('AC-TCH-05 a DOCX with a macro → rejected, the object is deleted', async () => {
    const id = await pending('Задание.docx', MACRO_DOCX);
    const key = (await status(id)).storageKey;
    expect(await scan(id)).toBe('rejected');
    expect((await status(id)).scanStatus).toBe('rejected');
    expect(removed).toContain(key);
    expect(objects.has(key)).toBe(false);
  });

  it('BR-FILE-03 olevba finding macros also rejects an office document', async () => {
    olevbaMacros = true;
    const id = await pending('Таблица.xlsx', CLEAN_DOCX);
    expect(await scan(id)).toBe('rejected');
  });

  it('BR-FILE-03 the EICAR test file → rejected by ClamAV (INSTREAM protocol)', async () => {
    const id = await pending('eicar.txt', EICAR);
    expect(await scan(id)).toBe('rejected');
    expect((await status(id)).scanStatus).toBe('rejected');
  });

  it('SM-FILE a clean file → clean with sha256; scanning it again changes nothing', async () => {
    const id = await pending('Конспект.docx', CLEAN_DOCX);
    expect(await scan(id)).toBe('clean');
    const row = await status(id);
    expect(row.scanStatus).toBe('clean');
    expect(row.sha256).toHaveLength(32);
    expect(await scan(id)).toBe('skipped');
    // Обложки olevba не проверяет: только антивирус.
    olevbaMacros = true;
    expect(await scan(await pending('cover.png', Buffer.from([0x89, 0x50]), 'cover'))).toBe('clean');
  });

  it('BR-FILE-03 an unavailable scanner keeps the file pending (the job is retried)', async () => {
    const id = await pending('a.pdf', Buffer.from('%PDF-1.4'));
    await expect(
      scanFile(
        { data: { mediaId: id } },
        {
          db,
          storage,
          logger,
          scanners: {
            antivirus: (d) => clamdScan('127.0.0.1:1', d),
            macros: async () => ({ macros: false }),
          },
        },
      ),
    ).rejects.toThrow();
    expect((await status(id)).scanStatus).toBe('pending');
    expect(FILE_SCAN_JOB_OPTIONS.attempts).toBeGreaterThan(1);
  });

  it('AC-PRF-04 a teacher avatar is re-encoded to WEBP 256 and 64 px; EXIF, GPS and the phone model are removed; the original is not kept', async () => {
    // Портретная JPEG 300×200 с EXIF: модель телефона, геолокация, поворот (orientation 6 — на 90°).
    const original = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#3366cc' } })
      .jpeg()
      .withExif({
        IFD0: { Make: 'PhoneMaker', Model: 'SecretPhone 12', Orientation: '6' },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '43/1 15/1 0/1',
          GPSLongitudeRef: 'E',
          GPSLongitude: '76/1 57/1 0/1',
        },
      })
      .toBuffer();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    expect(original.includes('SecretPhone')).toBe(true);

    const id = await pending('я.jpg', original, 'avatar');
    const key = (await status(id)).storageKey;
    expect(await scan(id)).toBe('clean');
    const row = await status(id);
    expect(row.mime).toBe('image/webp');

    const large = objects.get(key)!;
    const small = objects.get(`${key}-64`)!;
    for (const [data, size] of [
      [large, 256],
      [small, 64],
    ] as const) {
      const meta = await sharp(data).metadata();
      expect(meta.format).toBe('webp');
      expect([meta.width, meta.height]).toEqual([size, size]);
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(data.includes('SecretPhone')).toBe(false);
      expect(data.includes('PhoneMaker')).toBe(false);
      expect(data.includes('GPS')).toBe(false);
    }
    // Исходный JPEG не хранится: по ключу картинки — только перекодированная версия.
    expect(large.equals(original)).toBe(false);
    expect(row.sizeBytes).toBe(large.length);
  });

  it('BR-PRF-03 a broken or non-image avatar → rejected, both objects removed', async () => {
    const id = await pending('fake.png', Buffer.from('PNG not really a picture'), 'avatar');
    const key = (await status(id)).storageKey;
    expect(await scan(id)).toBe('rejected');
    expect(objects.has(key)).toBe(false);
    expect(removed).toContain(`${key}-64`);
    // Аватар с вирусом — тоже отклонён (ClamAV раньше перекодирования).
    expect(await scan(await pending('eicar.png', EICAR, 'avatar'))).toBe('rejected');
  });

  it('REQ-NFR-SEC-07 file names and contents are not logged', () => {
    const log = lines.join('');
    expect(log).not.toContain('Задание.docx');
    expect(log).not.toContain('EICAR');
  });

  it('API-T-17 the outbox publishes file.scan to the file-scan queue with jobId = mediaId', async () => {
    const id = await pending('outbox.pdf', Buffer.from('%PDF-1.4'));
    await db
      .insert(schema.outboxEvents)
      .values({ type: OUTBOX_EVENT_TYPES.fileScan, payload: { mediaId: id } });
    const added: Array<[string, unknown, { jobId?: string }]> = [];
    const fileScan = {
      add: async (...args: [string, unknown, { jobId?: string }]) => added.push(args),
    } as unknown as Queue;
    const email = { add: async () => undefined } as unknown as Queue;
    expect(await processOutbox(db, { email, fileScan }, logger)).toBeGreaterThanOrEqual(1);
    expect(added).toContainEqual(['scan', { mediaId: id }, expect.objectContaining({ jobId: id })]);
  });

  it('BR-DEL-02/05 file.delete → a delete job in file-scan (jobId per event); objects are removed, a missing one is not an error', async () => {
    const [event] = await db
      .insert(schema.outboxEvents)
      .values({ type: OUTBOX_EVENT_TYPES.fileDelete, payload: { storageKeys: ['cover/a', 'cover/b'] } })
      .returning();
    const added: Array<[string, unknown, { jobId?: string }]> = [];
    const fileScan = {
      add: async (...args: [string, unknown, { jobId?: string }]) => added.push(args),
    } as unknown as Queue;
    const email = { add: async () => undefined } as unknown as Queue;
    await processOutbox(db, { email, fileScan }, logger);
    expect(added).toContainEqual([
      'delete',
      { storageKeys: ['cover/a', 'cover/b'] },
      expect.objectContaining({ jobId: `delete-${event!.id}`, attempts: FILE_SCAN_JOB_OPTIONS.attempts }),
    ]);
    objects.set('cover/a', Buffer.from('x'));
    expect(await deleteObjects({ data: { storageKeys: ['cover/a', 'cover/b'] } }, { storage, logger })).toBe(
      2,
    );
    expect(objects.has('cover/a')).toBe(false);
    // Повтор задания — без ошибки (объектов уже нет).
    await deleteObjects({ data: { storageKeys: ['cover/a'] } }, { storage, logger });
  });

  it('BR-DEL-05 a scan of a file deleted from the gallery ends without an error', async () => {
    const id = await pending('deleted.png', Buffer.from('png'), 'cover');
    await db.delete(schema.mediaFiles).where(eq(schema.mediaFiles.id, id));
    expect(await scan(id)).toBe('skipped');
  });

  it('AC-DEL-09 a pending scan whose retries ran out (ClamAV unavailable) is retried; a missing job is re-added; others are left alone', async () => {
    const now = new Date();
    const queued = async (processedAgoMin: number) => {
      const id = await pending('stuck.png', Buffer.from('png'), 'cover');
      await db.insert(schema.outboxEvents).values({
        type: OUTBOX_EVENT_TYPES.fileScan,
        payload: { mediaId: id },
        processedAt: new Date(now.getTime() - processedAgoMin * 60_000),
      });
      return id;
    };
    const failed = await queued(30);
    const lost = await queued(30);
    const waiting = await queued(30);
    const recent = await queued(1);
    const retried: string[] = [];
    const added: Array<[string, unknown, { jobId?: string }]> = [];
    const states: Record<string, string> = { [failed]: 'failed', [waiting]: 'delayed', [recent]: 'failed' };
    const queue = {
      getJob: async (id: string) =>
        states[id]
          ? { getState: async () => states[id]!, retry: async () => void retried.push(id) }
          : undefined,
      add: async (...args: [string, { mediaId: string }, { jobId?: string }]) => void added.push(args),
    };
    expect(await requeueStuckScans(db, queue, now)).toBe(2);
    expect(retried).toEqual([failed]);
    expect(added).toEqual([['scan', { mediaId: lost }, expect.objectContaining({ jobId: lost })]]);
  });

  it('BR-FILE-07 unconfirmed uploads older than 24 h are deleted with their object; others stay', async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    const insert = async (createdAt: Date, confirmed: boolean) => {
      const key = `material/${crypto.randomUUID()}`;
      objects.set(key, Buffer.from('%PDF-1.4'));
      const [row] = await db
        .insert(schema.mediaFiles)
        .values({
          ownerId: DEMO_IDS.teacher,
          kind: 'material',
          originalName: 'a.pdf',
          mime: 'application/pdf',
          sizeBytes: 8,
          storageKey: key,
          createdAt,
        })
        .returning();
      if (confirmed)
        await db
          .insert(schema.outboxEvents)
          .values({ type: OUTBOX_EVENT_TYPES.fileScan, payload: { mediaId: row!.id } });
      return row!;
    };
    const stale = await insert(old, false);
    const waitingScan = await insert(old, true);
    const fresh = await insert(now, false);
    // Незавершённый материал уже привязан к теме (API-T-16) — привязка удаляется вместе с записью.
    const [topic] = await db.select({ id: schema.topics.id }).from(schema.topics).limit(1);
    await db.insert(schema.topicMaterials).values({ topicId: topic!.id, mediaId: stale.id, position: 99 });

    expect(await cleanupStaleUploads(db, storage, now)).toBe(1);
    const left = (await db.select({ id: schema.mediaFiles.id }).from(schema.mediaFiles)).map((r) => r.id);
    expect(left).not.toContain(stale.id);
    expect(left).toEqual(expect.arrayContaining([waitingScan.id, fresh.id]));
    expect(removed).toContain(stale.storageKey);
    expect(objects.has(waitingScan.storageKey)).toBe(true);
    const links = await db
      .select()
      .from(schema.topicMaterials)
      .where(eq(schema.topicMaterials.mediaId, stale.id));
    expect(links).toEqual([]);
    // Повторный запуск ничего не удаляет.
    expect(await cleanupStaleUploads(db, storage, now)).toBe(0);
  });

  it('SM-ATTEMPT in_progress attempts without activity for 30 days become abandoned', async () => {
    const now = new Date();
    const days = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
    const [quiz] = await db.select({ id: schema.quizzes.id }).from(schema.quizzes).limit(1);
    const [question] = await db
      .select({ id: schema.questions.id })
      .from(schema.questions)
      .where(eq(schema.questions.quizId, quiz!.id))
      .limit(1);
    const attempt = async (startedAt: Date, answeredAt?: Date) => {
      const [row] = await db
        .insert(schema.quizAttempts)
        .values({ studentId: DEMO_IDS.teacher, quizId: quiz!.id, startedAt })
        .returning();
      if (answeredAt)
        await db
          .insert(schema.attemptAnswers)
          .values({ attemptId: row!.id, questionId: question!.id, isCorrect: true, answeredAt });
      return row!.id;
    };
    const stale = await attempt(days(40));
    const activeLately = await attempt(days(40), days(5));
    const recent = await attempt(days(3));
    expect(await abandonStaleAttempts(db, now)).toBe(1);
    const status = async (id: string) =>
      (await db.select().from(schema.quizAttempts).where(eq(schema.quizAttempts.id, id)))[0]!.status;
    expect(await status(stale)).toBe('abandoned');
    expect(await status(activeLately)).toBe('in_progress');
    expect(await status(recent)).toBe('in_progress');
  });
});
