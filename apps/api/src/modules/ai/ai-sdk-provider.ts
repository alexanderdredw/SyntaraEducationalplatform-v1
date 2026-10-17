import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { type LanguageModel, streamText } from 'ai';
import { type Env } from '../../config/env';
import { type LLMProvider, type Prompt, ProviderUnavailableError, type Usage } from './llm-provider';

/** Длина ответа: учебные объяснения короткие (уровень beginner, PH-21); ограничивает и стоимость. */
const MAX_OUTPUT_TOKENS = 1024;

/**
 * Реальная модель через Vercel AI SDK (раздел 2.1) за интерфейсом LLMProvider (BR-AI-01): openai-compatible
 * (любой API в формате OpenAI Chat Completions) или anthropic. Выбор поставщика, ключ и модель — только
 * переменные окружения сервера (AG-10); какую модель использовать — Q-11, TODO(OWNER).
 * Инструментов нет — модель только генерирует текст (BR-AI-03).
 */
export class AiSdkProvider implements LLMProvider {
  constructor(
    readonly name: string,
    private readonly model: LanguageModel,
    private readonly secret: string,
  ) {}

  async *stream(
    prompt: Prompt,
    signal: AbortSignal,
    onUsage?: (usage: Usage) => void,
  ): AsyncIterable<string> {
    const result = streamText({
      model: this.model,
      system: prompt.system,
      messages: prompt.messages,
      abortSignal: signal,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      maxRetries: 1,
      // По умолчанию SDK печатает ошибку поставщика в консоль целиком (с текстом ответа, где может оказаться ключ);
      // ошибка приходит частью потока 'error' и журналируется без секретов (AG-10, REQ-NFR-SEC-07).
      onError: () => undefined,
    });
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') yield part.text;
      else if (part.type === 'error') throw this.unavailable(part.error);
      else if (part.type === 'finish') {
        onUsage?.({
          tokensIn: part.totalUsage.inputTokens ?? null,
          tokensOut: part.totalUsage.outputTokens ?? null,
        });
      }
    }
  }

  /** Ошибка поставщика без секретов: ключ вырезается из текста, тела запроса и заголовки не передаются дальше. */
  private unavailable(error: unknown): ProviderUnavailableError {
    const message = error instanceof Error ? error.message : String(error);
    return new ProviderUnavailableError(redactSecret(message, this.secret));
  }
}

/** Ключ поставщика никогда не попадает в журналы (AG-10, REQ-NFR-SEC-07). */
export function redactSecret(text: string, secret: string): string {
  return secret ? text.split(secret).join('[REDACTED]') : text;
}

/** Реальный поставщик по переменным окружения; null — LLM_PROVIDER = mock. */
export function createRealProvider(env: Env, fetch?: typeof globalThis.fetch): LLMProvider | null {
  const apiKey = env.LLM_API_KEY ?? '';
  const modelId = env.LLM_MODEL ?? '';
  switch (env.LLM_PROVIDER) {
    case 'mock':
      return null;
    case 'anthropic': {
      const provider = createAnthropic({ apiKey, baseURL: env.LLM_BASE_URL, fetch });
      return new AiSdkProvider('anthropic', provider(modelId), apiKey);
    }
    case 'openai-compatible': {
      const provider = createOpenAICompatible({
        name: 'llm',
        baseURL: env.LLM_BASE_URL!,
        apiKey,
        includeUsage: true,
        fetch,
      });
      return new AiSdkProvider('openai-compatible', provider.chatModel(modelId), apiKey);
    }
  }
}
