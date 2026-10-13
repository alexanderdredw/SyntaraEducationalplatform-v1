import './instrument';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ENV, type Env } from './config/env';
import { buildOpenApi, configureApp, mountOpenApi } from './setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);
  mountOpenApi(app, buildOpenApi(app));
  const env = app.get<Env>(ENV);
  await app.listen(env.API_PORT);
}

void bootstrap();
