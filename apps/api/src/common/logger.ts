import { type Params } from 'nestjs-pino';
import { type IncomingMessage } from 'node:http';
import { genRequestId } from './request-id';

/**
 * REQ-NFR-SEC-07: в журналах нет содержимого форм, чата, паролей, токенов; есть requestId.
 * Тела запросов не журналируются вовсе; заголовки с секретами и строка запроса скрываются.
 */
export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'req.headers["idempotency-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.email',
  '*.phone',
  '*.content',
  '*.description',
];

export function stripQuery(url: string | undefined): string {
  return (url ?? '').split('?')[0] ?? '';
}

export function buildLoggerParams(level: string): Params {
  return {
    pinoHttp: {
      level,
      genReqId: genRequestId,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      serializers: {
        req: (req: IncomingMessage & { id?: string }) => ({
          id: req.id,
          method: req.method,
          url: stripQuery(req.url),
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      autoLogging: { ignore: (req) => stripQuery(req.url) === '/api/health' },
    },
  };
}
