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

  it('API-GEN-06 rate limits are on by default and cannot be disabled in production', () => {
    expect(loadEnv(base).RATE_LIMITS_DISABLED).toBe(false);
    expect(loadEnv({ ...base, RATE_LIMITS_DISABLED: 'true' }).RATE_LIMITS_DISABLED).toBe(true);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', RATE_LIMITS_DISABLED: 'true' })).toThrow(
      /RATE_LIMITS_DISABLED/,
    );
  });

  it('BR-AI-01, AG-10 a real LLM provider needs a key and a model (and a base URL for openai-compatible); values are not echoed', () => {
    expect(() => loadEnv({ ...base, LLM_PROVIDER: 'anthropic' })).toThrow(/LLM_API_KEY/);
    expect(() =>
      loadEnv({ ...base, LLM_PROVIDER: 'openai-compatible', LLM_API_KEY: 'sk-secret-123', LLM_MODEL: 'm' }),
    ).toThrow(/LLM_BASE_URL/);
    try {
      loadEnv({ ...base, LLM_PROVIDER: 'openai-compatible', LLM_API_KEY: 'sk-secret-123', LLM_MODEL: 'm' });
    } catch (err) {
      expect((err as Error).message).not.toContain('sk-secret-123');
    }
    const env = loadEnv({ ...base, LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k', LLM_MODEL: 'm' });
    expect(env.LLM_PROVIDER).toBe('anthropic');
  });

  it('AC-ST-06 the tutor fixture stream is test-only: forbidden in production', () => {
    expect(loadEnv({ ...base, AI_TUTOR_FIXTURE: 'true' }).AI_TUTOR_FIXTURE).toBe(true);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', AI_TUTOR_FIXTURE: 'true' })).toThrow(
      /AI_TUTOR_FIXTURE/,
    );
  });
});
