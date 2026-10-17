import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { ContentModule } from '../content/content.module';
import { AiModule } from './ai.module';
import { FixtureProvider } from './fixture-provider';
import { LLM_PROVIDER, type LLMProvider } from './llm-provider';
import { TutorController } from './tutor.controller';
import { TUTOR_PROVIDER, TutorService } from './tutor.service';

/**
 * Учебный ИИ (итерация 9, API-S-11..13). Отдельный модуль: ему нужны видимость и снимки тем из ContentModule,
 * а ContentModule сам использует поставщика ИИ (API-T-11). Для e2e — детерминированный поток (AI_TUTOR_FIXTURE).
 */
@Module({
  imports: [AiModule, ContentModule],
  controllers: [TutorController],
  providers: [
    TutorService,
    {
      provide: TUTOR_PROVIDER,
      inject: [ENV, LLM_PROVIDER],
      useFactory: (env: Env, provider: LLMProvider) =>
        env.AI_TUTOR_FIXTURE ? new FixtureProvider() : provider,
    },
  ],
})
export class TutorModule {}
