import { randomUUID } from 'node:crypto';
import { type IncomingMessage, type ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * requestId для журналов и ответа об ошибке (API-GEN-04, REQ-NFR-SEC-07).
 * Принимает заголовок от nginx, если он безопасного формата; иначе генерирует новый.
 */
export function genRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}
