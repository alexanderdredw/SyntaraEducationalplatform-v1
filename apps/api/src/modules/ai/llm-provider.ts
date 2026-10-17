import { type ChatMessage, type Locale } from '@syntara/shared';

/** Промпт для поставщика ИИ (BR-AI-02): системная инструкция с базой знаний и последние сообщения. */
export interface Prompt {
  system: string;
  messages: ChatMessage[];
  locale: Locale;
}

/** Расход токенов ответа (ai_messages.tokens_in / tokens_out), если поставщик его сообщает. */
export interface Usage {
  tokensIn: number | null;
  tokensOut: number | null;
}

/**
 * Поставщик ИИ (BR-AI-01): клиент обращается к ИИ только через API. Поставщик лишь генерирует текст —
 * инструментов с записью у него нет (BR-AI-03). Отмена — через `signal`.
 */
export interface LLMProvider {
  readonly name: string;
  stream(prompt: Prompt, signal: AbortSignal, onUsage?: (usage: Usage) => void): AsyncIterable<string>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export class ProviderUnavailableError extends Error {}
