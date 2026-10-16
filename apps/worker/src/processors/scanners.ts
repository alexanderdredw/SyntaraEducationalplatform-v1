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
 * завершение — нулевая длина. Ответ (до \0): `stream: OK` или `stream: <сигнатура> FOUND`.
 * Ошибка соединения или ответ `ERROR` — исключение: задание повторится, файл останется pending.
 */
export function clamdScan(hostPort: string, data: Buffer): Promise<{ infected: boolean }> {
  const [host, port] = hostPort.split(':');
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: host!, port: Number(port ?? 3310) });
    let reply = Buffer.alloc(0);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      socket.end();
      const text = reply.toString('utf8').replace(/\0/g, '').trim();
      if (text.endsWith('OK')) resolve({ infected: false });
      else if (text.endsWith('FOUND')) resolve({ infected: true });
      else reject(new Error('clamd: unexpected reply'));
    };
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error('clamd timeout')));
    socket.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    // Ответ с префиксом «z» завершается \0. Половинчатое закрытие (end) до ответа clamd воспринимает как
    // обрыв и закрывает соединение без ответа, поэтому завершающий блок отправляется обычной записью.
    socket.on('data', (c: Buffer) => {
      reply = Buffer.concat([reply, c]);
      if (reply.includes(0)) finish();
    });
    socket.on('end', finish);
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let i = 0; i < data.length; i += CHUNK) {
        const part = data.subarray(i, i + CHUNK);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(part.length);
        socket.write(size);
        socket.write(part);
      }
      socket.write(Buffer.alloc(4));
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
