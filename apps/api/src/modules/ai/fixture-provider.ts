import { setTimeout as sleep } from 'node:timers/promises';
import { type LLMProvider, type Prompt, type Usage } from './llm-provider';

/**
 * Детерминированный поток для e2e учебного ИИ (AI_TUTOR_FIXTURE, только вне продуктива): ответ приходит по словам
 * с задержкой, как у настоящей модели, — так проверяются потоковый вывод и «Остановить» (AC-ST-06).
 * Ответ содержит HTML и внешнюю ссылку — их должна вырезать санитизация (AC-ST-07).
 */
export class FixtureProvider implements LLMProvider {
  readonly name = 'fixture';

  constructor(
    private readonly wordDelayMs = 80,
    private readonly words = 40,
  ) {}

  async *stream(
    prompt: Prompt,
    signal: AbortSignal,
    onUsage?: (usage: Usage) => void,
  ): AsyncIterable<string> {
    const question = prompt.messages.at(-1)?.content ?? '';
    const reply = [
      `Fixture answer to «${question}».`,
      '<script>alert(1)</script>[external](https://example.com) [catalog](/learn/subjects)',
      ...Array.from({ length: this.words }, (_, i) => `word${i + 1}`),
    ].join(' ');
    for (const part of reply.match(/\S+\s*/g) ?? [reply]) {
      if (signal.aborted) return;
      yield part;
      await sleep(this.wordDelayMs, undefined, { signal });
    }
    onUsage?.({ tokensIn: prompt.system.length, tokensOut: reply.length });
  }
}
