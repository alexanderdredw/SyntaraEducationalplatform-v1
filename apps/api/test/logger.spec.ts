import pino from 'pino';
import { Writable } from 'node:stream';
import { REDACT_PATHS, stripQuery } from '../src/common/logger';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  const logger = pino({ redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } }, stream);
  return { logger, output: () => lines.join('') };
}

describe('logger (REQ-NFR-SEC-07)', () => {
  it('REQ-NFR-SEC-07 redacts passwords, tokens, cookies and form contents', () => {
    const { logger, output } = capture();
    logger.info({
      req: {
        headers: { cookie: 'sid=secret-session', authorization: 'Bearer t0k', 'x-csrf-token': 'csrf1' },
      },
      body: { password: 'hunter2', token: 'reset-tok', email: 'kid@example.kz', content: 'вопрос ИИ' },
    });
    const out = output();
    for (const secret of [
      'secret-session',
      't0k',
      'csrf1',
      'hunter2',
      'reset-tok',
      'kid@example.kz',
      'вопрос ИИ',
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('[REDACTED]');
  });

  it('REQ-NFR-SEC-07 strips query strings that may carry tokens', () => {
    expect(stripQuery('/api/auth/password/reset?token=abc')).toBe('/api/auth/password/reset');
    expect(stripQuery(undefined)).toBe('');
  });
});
