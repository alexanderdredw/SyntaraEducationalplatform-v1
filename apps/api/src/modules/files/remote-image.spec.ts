import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { deflateSync } from 'node:zlib';
import { ApiException } from '../../common/api-exception';
import { isPublicAddress, PUBLIC_ONLY, RemoteImageFetcher, type AddressPolicy } from './remote-image';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  deflateSync(Buffer.from('cover')),
]);

/** Ошибка API → { статус, ключ ошибки поля coverUrl }. */
async function failure(promise: Promise<unknown>): Promise<{ status: number; key?: string }> {
  try {
    await promise;
  } catch (err) {
    const e = err as ApiException;
    return { status: e.getStatus(), key: e.fieldErrors?.coverUrl };
  }
  throw new Error('expected a failure');
}

describe('BR-FILE-06 cover by link: SSRF protection and image checks', () => {
  let server: Server;
  let base: string;
  const loopbackOnly: AddressPolicy = { allowAddress: (ip) => ip === '127.0.0.1', allowPort: () => true };

  beforeAll(async () => {
    server = createServer((req, res) => {
      const send = (
        status: number,
        type: string,
        body: Buffer | string,
        headers: Record<string, string> = {},
      ) => {
        res.writeHead(status, { 'Content-Type': type, ...headers });
        res.end(body);
      };
      switch (req.url) {
        case '/cover.png':
          return send(200, 'image/png', PNG);
        case '/not-image':
          return send(200, 'text/html', '<html></html>');
        case '/fake.png':
          return send(200, 'image/png', 'not a png');
        case '/huge.png':
          return send(200, 'image/png', Buffer.concat([PNG, Buffer.alloc(5 * 1_048_576)]));
        case '/huge-chunked.png': {
          res.writeHead(200, { 'Content-Type': 'image/png', 'Transfer-Encoding': 'chunked' });
          res.write(PNG);
          for (let i = 0; i < 6; i++) res.write(Buffer.alloc(1_048_576));
          return res.end();
        }
        case '/to-internal':
          return send(302, 'text/plain', '', { Location: 'http://10.0.0.1/cover.png' });
        case '/to-cover':
          return send(302, 'text/plain', '', { Location: '/cover.png' });
        default:
          return send(404, 'text/plain', 'nope');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it('BR-FILE-06 internal and reserved addresses are not public', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      'not-an-ip',
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ['8.8.8.8', '93.184.216.34', '2001:4860:4860::8888', '172.32.0.1']) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });

  it.each([
    'http://localhost/cover.png',
    'http://127.0.0.1/cover.png',
    'http://10.0.0.5/cover.png',
    'http://192.168.0.10/cover.png',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/cover.png',
    'http://[::ffff:127.0.0.1]/cover.png',
    'http://0.0.0.0/cover.png',
    'ftp://example.org/cover.png',
    'file:///etc/passwd',
    'http://user:pass@example.org/cover.png',
    'http://example.org:8080/cover.png',
  ])('BR-FILE-06 SSRF: %s is refused without a request', async (url) => {
    expect(await failure(new RemoteImageFetcher(PUBLIC_ONLY).fetch(url))).toEqual({
      status: 422,
      key: 'coverDownload',
    });
  });

  it('BR-FILE-06 every redirect is checked again (no redirect into the internal network)', async () => {
    const fetcher = new RemoteImageFetcher(loopbackOnly);
    expect(await failure(fetcher.fetch(`${base}/to-internal`))).toEqual({
      status: 422,
      key: 'coverDownload',
    });
    expect((await fetcher.fetch(`${base}/to-cover`)).mime).toBe('image/png');
  });

  it('BR-FILE-01 the downloaded image is checked like an uploaded cover: type, signature, ≤ 5 MB', async () => {
    const fetcher = new RemoteImageFetcher(loopbackOnly);
    const ok = await fetcher.fetch(`${base}/cover.png`);
    expect(ok).toEqual({ data: PNG, mime: 'image/png', fileName: 'cover.png' });
    expect(await failure(fetcher.fetch(`${base}/not-image`))).toEqual({ status: 422, key: 'fileType' });
    expect(await failure(fetcher.fetch(`${base}/fake.png`))).toEqual({ status: 422, key: 'fileSignature' });
    expect(await failure(fetcher.fetch(`${base}/huge.png`))).toEqual({ status: 413, key: 'fileTooLarge' });
    expect(await failure(fetcher.fetch(`${base}/huge-chunked.png`))).toEqual({
      status: 413,
      key: 'fileTooLarge',
    });
    expect(await failure(fetcher.fetch(`${base}/missing.png`))).toEqual({
      status: 422,
      key: 'coverDownload',
    });
  });
});
