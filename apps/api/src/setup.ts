import { type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

/** Базовый путь API (API-GEN-01). */
export const API_PREFIX = 'api';

/** Общая настройка приложения — одна и та же для main.ts, тестов и генерации OpenAPI. */
export function configureApp(app: INestApplication): void {
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX);
  // Заголовки безопасности API (REQ-NFR-SEC-01; полный набор для web — итерация 3).
  app.use(
    helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }),
  );
  app.enableShutdownHooks();
}

/** OpenAPI 3 из декораторов NestJS (API-GEN-01). */
export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Syntara Education Platform API')
    .setVersion(process.env.npm_package_version ?? '0.0.0')
    .addCookieAuth('sid')
    .build();
  return SwaggerModule.createDocument(app, config);
}

export function mountOpenApi(app: INestApplication, document: OpenAPIObject): void {
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, document, { jsonDocumentUrl: `${API_PREFIX}/openapi.json` });
}
