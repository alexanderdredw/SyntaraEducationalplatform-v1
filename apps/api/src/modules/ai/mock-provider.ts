import { setTimeout as sleep } from 'node:timers/promises';
import { getMessage, LOCALES, type Locale, type Messages } from '@syntara/shared';
import ru from '@syntara/shared/i18n/ru.json';
import kk from '@syntara/shared/i18n/kk.json';
import en from '@syntara/shared/i18n/en.json';
import { type LLMProvider, type Prompt } from './llm-provider';

const BUNDLES: Record<Locale, Messages> = { ru, kk, en };
/** Быстрые вопросы PH-19 `ai.public_quick_answers` (тексты — в i18n, RU совпадает с seed). */
export const QUICK_KEYS = ['platform', 'start', 'language', 'registration'] as const;

const normalize = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[?？!.]+$/, '');

const text = (locale: Locale, key: string) =>
  getMessage(BUNDLES[locale], key) ?? getMessage(BUNDLES.ru, key) ?? '';

/** Ответ режима mock (PH-19): быстрый вопрос на любом языке → ответ-справка; иначе — «Помощник пока недоступен…». */
export function mockReply(message: string, locale: Locale): string {
  const asked = normalize(message);
  for (const key of QUICK_KEYS) {
    if (LOCALES.some((l) => normalize(text(l, `ai.quick.${key}.question`)) === asked)) {
      return text(locale, `ai.quick.${key}.answer`);
    }
  }
  const unavailable = text(locale, 'ai.chat.unavailable');
  const link = text(locale, 'ai.chat.supportLink');
  // REQ-PUB-AI-05: ссылка на /support (санитайзер BR-AI-07 её пропускает).
  return unavailable.replace(link, `[${link}](/support)`);
}

/**
 * MockProvider (BR-AI-06, PH-19 `ai.mode = mock`; решение владельца по Q-11): без внешнего поставщика.
 * Ответ выдаётся по словам с задержкой, как поток настоящей модели, — это проверяет «Остановить» и SSE.
 */
export class MockProvider implements LLMProvider {
  readonly name = 'mock';

  constructor(
    private readonly wordDelayMs = 60,
    private readonly firstTokenDelayMs = 300,
  ) {}

  async *stream(prompt: Prompt, signal: AbortSignal): AsyncIterable<string> {
    const last = [...prompt.messages].reverse().find((m) => m.role === 'user');
    const reply = mockReply(last?.content ?? '', prompt.locale);
    if (this.firstTokenDelayMs) await sleep(this.firstTokenDelayMs, undefined, { signal });
    const parts = reply.match(/\S+\s*/g) ?? [reply];
    for (const part of parts) {
      if (signal.aborted) return;
      yield part;
      if (this.wordDelayMs) await sleep(this.wordDelayMs, undefined, { signal });
    }
  }
}
