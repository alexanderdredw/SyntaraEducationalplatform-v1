// `pnpm openapi`: пишет apps/api/openapi.json — источник для типизированного клиента web (API-GEN-01).
// Подключения к БД/Redis не открываются (ленивые), поэтому достаточно фиктивных значений окружения.
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { buildOpenApi, configureApp } from './setup';

const placeholders: Record<string, string> = {
  DATABASE_URL: 'postgres://openapi:openapi@127.0.0.1:1/openapi',
  REDIS_URL: 'redis://127.0.0.1:1',
  S3_ENDPOINT: 'http://127.0.0.1:1',
  S3_BUCKET: 'openapi',
  S3_ACCESS_KEY: 'openapi',
  S3_SECRET_KEY: 'openapi',
  SESSION_SECRET: 'x'.repeat(64),
  APP_BASE_URL: 'http://127.0.0.1:3000',
};

async function main(): Promise<void> {
  for (const [key, value] of Object.entries(placeholders)) process.env[key] = value;
  process.env.NODE_ENV = 'test';
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.init();
  const document = buildOpenApi(app);
  writeFileSync(join(__dirname, '..', 'openapi.json'), JSON.stringify(document, null, 2) + '\n');
  await app.close();
}

void main();
