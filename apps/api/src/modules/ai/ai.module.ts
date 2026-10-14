import { Logger, Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { LLM_PROVIDER, type LLMProvider } from './llm-provider';
import { MockProvider } from './mock-provider';

/**
 * Поставщик ИИ (BR-AI-01, BR-AI-06): пока LLM_PROVIDER = 'mock' или настоящий поставщик не подключён — PH-19.
 * TODO(OWNER): подключение реальной модели (openai-compatible / anthropic через Vercel AI SDK) — решение по Q-11
 * отложено владельцем 2026-10-14; до него любой LLM_PROVIDER работает как mock.
 */
export function createProvider(env: Env): LLMProvider {
  if (env.LLM_PROVIDER !== 'mock') {
    new Logger('AiModule').warn(`LLM_PROVIDER=${env.LLM_PROVIDER} is not connected yet (Q-11) — using mock`);
  }
  return new MockProvider();
}

/** Модуль «ai» (раздел 2.2 SPEC): публичный помощник (итерация 5); учебный ИИ — итерация 9. */
@Module({
  controllers: [AssistantController],
  providers: [AssistantService, { provide: LLM_PROVIDER, inject: [ENV], useFactory: createProvider }],
})
export class AiModule {}
