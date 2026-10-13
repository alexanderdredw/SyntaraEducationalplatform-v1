import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { type Response } from 'express';
import Redis from 'ioredis';
import { type Database, sql } from '@syntara/db';
import { DB, REDIS } from '../infra/infra.module';

class HealthChecksDto {
  @ApiProperty({ enum: ['ok', 'down'] }) database: 'ok' | 'down';
  @ApiProperty({ enum: ['ok', 'down'] }) redis: 'ok' | 'down';
}

export class HealthDto {
  @ApiProperty({ enum: ['ok', 'degraded'] }) status: 'ok' | 'degraded';
  @ApiProperty({ type: HealthChecksDto }) checks: HealthChecksDto;
}

/** Проверка готовности api: PostgreSQL и Redis (итерация 1, `pnpm dev` поднимает всё). */
@ApiTags('system')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  @ApiOkResponse({ type: HealthDto })
  @ApiServiceUnavailableResponse({ type: HealthDto })
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthDto> {
    const [database, redis] = await Promise.all([
      this.probe(() => this.db.execute(sql`select 1`)),
      this.probe(async () => {
        if (this.redis.status === 'wait') await this.redis.connect();
        return this.redis.ping();
      }),
    ]);
    const status = database === 'ok' && redis === 'ok' ? 'ok' : 'degraded';
    if (status !== 'ok') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status, checks: { database, redis } };
  }

  private async probe(fn: () => Promise<unknown>): Promise<'ok' | 'down'> {
    try {
      await Promise.race([
        fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
      ]);
      return 'ok';
    } catch {
      return 'down';
    }
  }
}
