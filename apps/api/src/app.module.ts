import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigService } from './config/app-config.service';
import { ENV, type Env } from './config/env';
import { RedisThrottlerStorage, throttlerOptions } from './common/rate-limit';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { buildLoggerParams } from './common/logger';
import { HealthController } from './health/health.controller';
import { InfraModule } from './infra/infra.module';
import { MetricsController } from './metrics/metrics.controller';
import { DOMAIN_MODULES } from './modules';

@Module({
  imports: [
    LoggerModule.forRoot(buildLoggerParams(process.env.NODE_ENV === 'test' ? 'silent' : 'info')),
    InfraModule,
    ThrottlerModule.forRootAsync({
      inject: [ENV, RedisThrottlerStorage, AppConfigService],
      useFactory: (env: Env, storage: RedisThrottlerStorage, config: AppConfigService) =>
        throttlerOptions(env, storage, config),
    }),
    ...DOMAIN_MODULES,
  ],
  controllers: [HealthController, MetricsController],
  providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule {}
