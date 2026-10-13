import {
  Body,
  Controller,
  Get,
  HttpStatus,
  NotFoundException,
  Post,
  type INestApplication,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';
import request from 'supertest';
import { SchoolRequestDto } from '@syntara/shared';
import { ApiException } from '../src/common/api-exception';
import { ApiExceptionFilter } from '../src/common/api-exception.filter';
import { buildLoggerParams } from '../src/common/logger';
import { ZodValidationPipe } from '../src/common/zod-validation.pipe';

@Controller('probe')
class ProbeController {
  @Get('not-found')
  notFound(): never {
    throw new NotFoundException();
  }

  @Get('crash')
  crash(): never {
    throw new Error('db password=hunter2 leaked');
  }

  @Get('limited')
  limited(): never {
    throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', 'Too many requests', undefined, 42);
  }

  @Post('form')
  form(@Body(new ZodValidationPipe(SchoolRequestDto)) body: SchoolRequestDto): SchoolRequestDto {
    return body;
  }
}

describe('ApiExceptionFilter (API-GEN-04)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule.forRoot(buildLoggerParams('silent'))],
      controllers: [ProbeController],
      providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(() => app.close());

  it('API-GEN-04 404 has code, message and requestId matching the response header', async () => {
    const res = await request(app.getHttpServer()).get('/api/probe/not-found').expect(404);
    expect(res.body).toEqual({
      code: 'NOT_FOUND',
      message: expect.any(String),
      requestId: expect.any(String),
    });
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('API-GEN-04 keeps a safe incoming X-Request-Id and replaces an unsafe one', async () => {
    const ok = await request(app.getHttpServer())
      .get('/api/probe/not-found')
      .set('X-Request-Id', 'abc-12345-def');
    expect(ok.body.requestId).toBe('abc-12345-def');
    const bad = await request(app.getHttpServer())
      .get('/api/probe/not-found')
      .set('X-Request-Id', '<script>');
    expect(bad.body.requestId).not.toBe('<script>');
  });

  it('API-GEN-04 validation errors return fieldErrors with i18n keys', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/probe/form')
      .send({ schoolName: '', contactPerson: 'X', email: 'bad' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.fieldErrors).toEqual({ schoolName: 'required', email: 'email' });
  });

  it('REQ-NFR-SEC-07 unexpected errors return 500 without internal details', async () => {
    const res = await request(app.getHttpServer()).get('/api/probe/crash').expect(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('API-GEN-06 429 carries retryAfterSeconds and Retry-After', async () => {
    const res = await request(app.getHttpServer()).get('/api/probe/limited').expect(429);
    expect(res.body).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 42 });
    expect(res.headers['retry-after']).toBe('42');
  });
});
