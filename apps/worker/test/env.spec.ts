import { loadEnv } from '../src/env';
import { QUEUE_NAMES } from '../src/queues';

const base = {
  REDIS_URL: 'redis://localhost:6379',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  SMTP_URL: 'smtp://localhost:1025',
  MAIL_FROM: 'noreply@syntara-edu.me',
  APP_BASE_URL: 'http://localhost:3000',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'syntara-files',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
  CLAMD_HOST: 'localhost:3310',
  OLEVBA_URL: 'http://localhost:8080',
};

describe('worker env', () => {
  it('2.2 WORKER_QUEUES: all queues by default; a subset for e2e (file checks only); unknown → error', () => {
    expect(loadEnv(base).WORKER_QUEUES).toEqual([...QUEUE_NAMES]);
    expect(loadEnv({ ...base, WORKER_QUEUES: '' }).WORKER_QUEUES).toEqual([...QUEUE_NAMES]);
    expect(loadEnv({ ...base, WORKER_QUEUES: 'outbox, file-scan' }).WORKER_QUEUES).toEqual([
      'outbox',
      'file-scan',
    ]);
    expect(() => loadEnv({ ...base, WORKER_QUEUES: 'outbox,recalc' })).toThrow(/WORKER_QUEUES/);
  });

  it('BR-FILE-03 ClamAV and olevba addresses are required — file checks cannot be switched off', () => {
    const { CLAMD_HOST: _c, ...noClam } = base;
    expect(() => loadEnv(noClam)).toThrow(/CLAMD_HOST/);
    const { OLEVBA_URL: _o, ...noOlevba } = base;
    expect(() => loadEnv(noOlevba)).toThrow(/OLEVBA_URL/);
  });
});
