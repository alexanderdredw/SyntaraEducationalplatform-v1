import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { AiDraftResult, type AiDraftResult as AiDraft } from '@syntara/shared';
import { ApiException } from '../../common/api-exception';
import { ENV, type Env } from '../../config/env';
import { LLM_PROVIDER, type LLMProvider } from '../ai/llm-provider';

const unavailable = () =>
  new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'SERVICE_UNAVAILABLE', 'AI draft is unavailable');

/** REQ-NFR-PERF-03: первый токен ИИ — до 45 с; черновик целиком — не дольше. */
const DRAFT_TIMEOUT_MS = 45_000;

/**
 * Черновик для тестов (решение Q-13): включается только переменной AI_DRAFT_FIXTURE вне продуктива и
 * проверяет, что форма заполняет RU и KK, ничего не сохраняя (AC-TCH-04).
 */
export function fixtureDraft(title: string): AiDraft {
  const subject = title || '—';
  return {
    ru: {
      title: title || 'Черновик ИИ',
      description: `Черновик ИИ: ${subject}`,
      funFact: `Факт ИИ: ${subject}`,
      bodyMd: `## ${subject}\n\nТекст урока от ИИ.`,
    },
    kk: {
      title: `ЖИ: ${subject}`,
      description: `ЖИ жобасы: ${subject}`,
      funFact: `ЖИ дерегі: ${subject}`,
      bodyMd: `## ${subject}\n\nЖИ сабақ мәтіні.`,
    },
  };
}

/**
 * API-T-11 (REQ-TCH-TOP-02): название, описание, факт и текст урока на RU и KK через LLMProvider (BR-AI-01);
 * название — на языке черновика, учитель может его поправить (решение владельца 2026-10-16).
 * Ничего не сохраняет (BR-AI-03). Пока ai.mode = mock (PH-19, Q-11) или поставщик недоступен — 503, и интерфейс
 * показывает «ИИ-черновик сейчас недоступен». В промпт уходит только название темы (BR-AI-02).
 */
@Injectable()
export class AiDraftService {
  private readonly logger = new Logger(AiDraftService.name);

  constructor(
    @Inject(LLM_PROVIDER) private readonly provider: LLMProvider,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async draft(title: string): Promise<AiDraft> {
    if (this.env.AI_DRAFT_FIXTURE) return fixtureDraft(title);
    if (this.provider.name === 'mock') throw unavailable();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DRAFT_TIMEOUT_MS);
    try {
      let text = '';
      for await (const delta of this.provider.stream(
        {
          system:
            'Ты помогаешь учителю подготовить черновик школьного урока. Ответь только JSON вида ' +
            '{"ru":{"title":"","description":"","funFact":"","bodyMd":""},"kk":{"title":"","description":"","funFact":"","bodyMd":""}}: ' +
            'название на языке черновика до 150 символов, ' +
            'описание до 1000 символов, интересный факт до 500, текст урока в Markdown (заголовки ##, списки).',
          messages: [{ role: 'user', content: `Тема урока: ${title}` }],
          locale: 'ru',
        },
        controller.signal,
      )) {
        text += delta;
      }
      const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
      return AiDraftResult.parse(JSON.parse(json));
    } catch (err) {
      this.logger.warn(`AI draft failed: ${(err as Error).name}`);
      throw unavailable();
    } finally {
      clearTimeout(timer);
    }
  }
}
