import { createConnection } from 'node:net';

/** Ответ антивируса и анализатора макросов (BR-FILE-03). */
export interface Scanners {
  /** ClamAV: найден вредоносный код. */
  antivirus(data: Buffer): Promise<{ infected: boolean }>;
  /** olevba: в офисном документе есть макросы. */
  macros(data: Buffer): Promise<{ macros: boolean }>;
}

const CHUNK = 64 * 1024;
const TIMEOUT_MS = 60_000;

/**
 * Клиент clamd по протоколу INSTREAM: `zINSTREAM\0`, затем куски «длина (4 байта, big-endian) + данные»,
 * завершение — нулевая длина. Ответ: `stream: OK` или `stream: <сигнатура> FOUND`.
 * Ошибка соединения или ответ `ERROR` — исключение: задание повторится, файл останется pending.
 */
export function clamdScan(hostPort: string, data: Buffer): Promise<{ infected: boolean }> {
  const [host, port] = hostPort.split(':');
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: host!, port: Number(port ?? 3310) });
    const chunks: Buffer[] = [];
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error('clamd timeout')));
    socket.on('error', reject);
    socket.on('data', (c: Buffer) => chunks.push(c));
    socket.on('end', () => {
      const reply = Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim();
      if (reply.endsWith('OK')) resolve({ infected: false });
      else if (reply.endsWith('FOUND')) resolve({ infected: true });
      else reject(new Error(`clamd: unexpected reply`));
    });
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let i = 0; i < data.length; i += CHUNK) {
        const part = data.subarray(i, i + CHUNK);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(part.length);
        socket.write(size);
        socket.write(part);
      }
      socket.end(Buffer.alloc(4));
    });
  });
}

/** Сервис olevba (infra/olevba): POST /scan с байтами файла → { macros, suspicious }. */
export async function olevbaScan(baseUrl: string, data: Buffer): Promise<{ macros: boolean }> {
  const res = await fetch(new URL('/scan', baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(data),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`olevba: HTTP ${res.status}`);
  const body = (await res.json()) as { macros?: boolean };
  return { macros: body.macros === true };
}

export function createScanners(clamdHost: string, olevbaUrl: string): Scanners {
  return {
    antivirus: (data) => clamdScan(clamdHost, data),
    macros: (data) => olevbaScan(olevbaUrl, data),
  };
}
