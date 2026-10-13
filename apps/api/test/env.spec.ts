import { loadEnv } from '../src/config/env';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'b',
  S3_ACCESS_KEY: 'k',
  S3_SECRET_KEY: 'super-secret-value',
  SESSION_SECRET: 's'.repeat(64),
  APP_BASE_URL: 'http://localhost:3000',
};

describe('env (раздел 2.3)', () => {
  it('AG-10 applies defaults for optional variables', () => {
    const env = loadEnv(base);
    expect(env.API_PORT).toBe(3001);
    expect(env.LLM_PROVIDER).toBe('mock');
    expect(env.PLATFORM_TZ).toBe('Asia/Almaty');
  });

  it('AG-10 fails fast when a required variable is missing, naming it without values', () => {
    const { DATABASE_URL: _omit, ...rest } = base;
    expect(() => loadEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('REQ-NFR-SEC-07 validation error does not leak secret values', () => {
    try {
      loadEnv({ ...base, SESSION_SECRET: 'short', S3_ENDPOINT: 'not a url' });
      expect.unreachable();
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toMatch(/SESSION_SECRET/);
      expect(message).not.toContain('short');
      expect(message).not.toContain('super-secret-value');
    }
  });

  it('treats empty strings from .env as unset', () => {
    expect(loadEnv({ ...base, LLM_PROVIDER: '' }).LLM_PROVIDER).toBe('mock');
  });
});
