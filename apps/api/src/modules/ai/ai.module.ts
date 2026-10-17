import { Logger, Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { createRealProvider } from './ai-sdk-provider';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { LLM_PROVIDER, type LLMProvider } from './llm-provider';
import { MockProvider } from './mock-provider';

/**
 * Поставщик ИИ (BR-AI-01, BR-AI-06): LLM_PROVIDER = 'mock' (по умолчанию) — PH-19 без внешнего поставщика;
 * openai-compatible / anthropic — реальная модель через Vercel AI SDK (ai-sdk-provider.ts).
 * Реальный ИИ пока не подключается — поставщик будет выбран позже (решение владельца 2026-10-17, Q-11);
 * порядок подключения и критерии выбора (в т. ч. хранение данных в РК, REQ-NFR-DATA-01) — docs/AI_PROVIDER.md.
 */
export function createProvider(env: Env): LLMProvider {
  const real = createRealProvider(env);
  if (real) {
    // Только имя поставщика и модели — без ключа (AG-10).
    new Logger('AiModule').log(`LLM provider: ${real.name}, model: ${env.LLM_MODEL}`);
    return real;
  }
  return new MockProvider();
}

/** Модуль «ai» (раздел 2.2 SPEC): поставщик ИИ и публичный помощник (итерация 5); учебный ИИ — TutorModule. */
@Module({
  controllers: [AssistantController],
  providers: [AssistantService, { provide: LLM_PROVIDER, inject: [ENV], useFactory: createProvider }],
  exports: [LLM_PROVIDER],
})
export class AiModule {}
