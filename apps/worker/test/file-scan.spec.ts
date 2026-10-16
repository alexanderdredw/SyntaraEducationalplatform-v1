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
import { FILE_SCAN_JOB_OPTIONS, hasMacroParts, scanFile, zipEntryNames } from '../src/processors/file-scan';
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
    kind: 'material' | 'cover' = 'material',
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
});
