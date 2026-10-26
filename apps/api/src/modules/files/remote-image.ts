import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import {
  COVER_MIME,
  coverSignatureOk,
  FILE_LIMITS,
  isCoverMime,
  isSpreadsheetContent,
  isSpreadsheetFile,
  SPREADSHEET_ERROR,
} from '@syntara/shared';
import { ApiException } from '../../common/api-exception';

/** Адреса, куда сервер не ходит (SSRF): локальные, частные, служебные, зарезервированные. */
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv6');
}

/** Публичный ли адрес (IPv4, IPv6, IPv4-mapped IPv6). */
export function isPublicAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  const v4 = mapped?.[1] ?? (isIP(ip) === 4 ? ip : null);
  if (v4) return !BLOCKED.check(v4, 'ipv4');
  if (isIP(ip) === 6) return !BLOCKED.check(ip, 'ipv6');
  return false;
}

/** Политика адресов и портов — отдельно, чтобы integration-тест мог обратиться к своему локальному серверу. */
export const REMOTE_ADDRESS_POLICY = Symbol('REMOTE_ADDRESS_POLICY');
export interface AddressPolicy {
  allowAddress(ip: string): boolean;
  allowPort(port: string): boolean;
}
export const PUBLIC_ONLY: AddressPolicy = {
  allowAddress: isPublicAddress,
  // Только стандартные порты http/https: сервер не перебирает служебные порты.
  allowPort: (port) => port === '' || port === '80' || port === '443',
};

const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

const download = (key: 'coverDownload') =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'UNPROCESSABLE', 'Cover link not accepted', {
    coverUrl: key,
  });
const rejected = (status: number, key: string) =>
  new ApiException(status, status === 413 ? 'PAYLOAD_TOO_LARGE' : 'UNPROCESSABLE', 'Cover not accepted', {
    coverUrl: key,
  });

export interface RemoteImage {
  data: Buffer;
  mime: (typeof COVER_MIME)[number];
  fileName: string;
}

/**
 * BR-FILE-06: обложка по ссылке скачивается сервером и проверяется как загруженная (BR-FILE-01: тип, ≤ 5 МБ,
 * сигнатура). Защита от SSRF: только http/https и порты 80/443, без учётных данных в адресе; каждый адрес после
 * разрешения DNS проверяется политикой, соединение идёт на проверенный адрес (без повторного DNS — защита от
 * DNS-rebinding); перенаправления (до 3) проверяются заново; таймаут 10 с; чтение прерывается после 5 МБ.
 */
@Injectable()
export class RemoteImageFetcher {
  constructor(@Inject(REMOTE_ADDRESS_POLICY) private readonly policy: AddressPolicy) {}

  async fetch(rawUrl: string): Promise<RemoteImage> {
    const deadline = AbortSignal.timeout(TIMEOUT_MS);
    let url = this.parse(rawUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const address = await this.resolve(url.hostname);
      const res = await this.request(url, address, deadline);
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        res.body.destroy();
        if (!res.location) throw download('coverDownload');
        url = this.parse(new URL(res.location, url).toString());
        continue;
      }
      if (res.status !== 200) {
        res.body.destroy();
        throw download('coverDownload');
      }
      const mime = (res.contentType ?? '').split(';')[0]!.trim().toLowerCase();
      // BR-FILE-09: таблица по ссылке — та же ошибка, что при загрузке файла.
      if (isSpreadsheetFile(url.pathname, mime)) {
        res.body.destroy();
        throw rejected(422, SPREADSHEET_ERROR);
      }
      if (!isCoverMime(mime)) {
        res.body.destroy();
        throw rejected(422, 'fileType');
      }
      const data = await this.read(res.body, res.length);
      if (isSpreadsheetContent(data)) throw rejected(422, SPREADSHEET_ERROR);
      if (!coverSignatureOk(mime, data)) throw rejected(422, 'fileSignature');
      const name = decodeURIComponent(url.pathname.split('/').pop() || '').slice(0, 200) || 'cover';
      return { data, mime, fileName: name };
    }
    throw download('coverDownload');
  }

  private parse(raw: string): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw download('coverDownload');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      !this.policy.allowPort(url.port)
    )
      throw download('coverDownload');
    return url;
  }

  private async resolve(hostname: string): Promise<{ address: string; family: number }> {
    const host = hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await lookup(host, { all: true }).catch(() => {
          throw download('coverDownload');
        });
    // Все адреса имени должны быть разрешены: иначе ответ DNS мог бы направить запрос во внутреннюю сеть.
    if (addresses.length === 0 || !addresses.every((a) => this.policy.allowAddress(a.address)))
      throw download('coverDownload');
    return addresses[0]!;
  }

  private request(
    url: URL,
    pinned: { address: string; family: number },
    signal: AbortSignal,
  ): Promise<{
    status: number;
    location?: string;
    contentType?: string;
    length: number | null;
    body: http.IncomingMessage;
  }> {
    const pinnedLookup: LookupFunction = (_host, options, callback) => {
      if (options.all) callback(null, [pinned]);
      else callback(null, pinned.address, pinned.family);
    };
    const client = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const req = client.get(
        url,
        { lookup: pinnedLookup, signal, timeout: TIMEOUT_MS, headers: { Accept: COVER_MIME.join(', ') } },
        (res) =>
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location,
            contentType: res.headers['content-type'],
            length: res.headers['content-length'] ? Number(res.headers['content-length']) : null,
            body: res,
          }),
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', () => reject(download('coverDownload')));
    });
  }

  private read(body: http.IncomingMessage, length: number | null): Promise<Buffer> {
    if (length !== null && length > FILE_LIMITS.coverMaxBytes) {
      body.destroy();
      return Promise.reject(rejected(413, 'fileTooLarge'));
    }
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      body.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > FILE_LIMITS.coverMaxBytes) {
          body.destroy();
          reject(rejected(413, 'fileTooLarge'));
          return;
        }
        chunks.push(chunk);
      });
      body.on('end', () => resolve(Buffer.concat(chunks)));
      body.on('error', () => reject(download('coverDownload')));
    });
  }
}
