import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { buildOpenApi, configureApp } from '../src/setup';

/** Integration (Testcontainers): Postgres 16 + Redis 7, как в docker-compose. */
describe('GET /api/health (integration)', () => {
  let pg: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;
  let app: INestApplication;

  const env = (overrides: Record<string, string> = {}) => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: pg.getConnectionUri(),
      REDIS_URL: redis.getConnectionUrl(),
      S3_ENDPOINT: 'http://127.0.0.1:9000',
      S3_BUCKET: 'test',
      S3_ACCESS_KEY: 'test',
      S3_SECRET_KEY: 'test',
      SESSION_SECRET: 'x'.repeat(64),
      APP_BASE_URL: 'http://127.0.0.1:3000',
      ...overrides,
    });
  };

  const createApp = async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const nest = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(nest);
    await nest.init();
    return nest;
  };

  beforeAll(async () => {
    [pg, redis] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);
    env();
    app = await createApp();
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([pg?.stop(), redis?.stop()]);
  });

  it('API-GEN-01 serves /api/health with database and redis checks', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
  });

  it('API-GEN-01 is mounted under the /api prefix only', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('REQ-NFR-SEC-01 sets baseline security headers', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('REQ-NFR-OBS-01 exposes Prometheus metrics', async () => {
    const res = await request(app.getHttpServer()).get('/api/metrics').expect(200);
    expect(res.text).toContain('process_cpu_user_seconds_total');
  });

  it('API-GEN-01 OpenAPI document describes /api/health', () => {
    const doc = buildOpenApi(app);
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.paths['/api/health']?.get).toBeDefined();
    expect(doc.paths['/api/metrics']).toBeUndefined();
  });

  it('API-GEN-04 reports 503 degraded when Redis is unreachable', async () => {
    env({ REDIS_URL: 'redis://127.0.0.1:1' });
    const degraded = await createApp();
    try {
      const res = await request(degraded.getHttpServer()).get('/api/health').expect(503);
      expect(res.body).toEqual({ status: 'degraded', checks: { database: 'ok', redis: 'down' } });
    } finally {
      await degraded.close();
      env();
    }
  });
});
