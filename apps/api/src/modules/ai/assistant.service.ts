import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Response } from 'express';
import {
  type AssistantEvent,
  type Locale,
  type PublicAssistantDto,
  serializeSse,
  StreamingSanitizer,
} from '@syntara/shared';
import { AppConfigService } from '../../config/app-config.service';
import { LLM_PROVIDER, type LLMProvider } from './llm-provider';
import { buildPublicPrompt } from './prompt';

/**
 * API-PUB-06: ответ публичного помощника потоком SSE (`delta` … `done` / `error`).
 * Ответ проходит санитизацию ссылок и HTML (BR-AI-07); ничего не сохраняется (BR-AI-05);
 * содержимое переписки в журнал не пишется (REQ-NFR-SEC-07).
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    @Inject(LLM_PROVIDER) private readonly provider: LLMProvider,
    private readonly config: AppConfigService,
  ) {}

  async stream(dto: PublicAssistantDto, locale: Locale, res: Response, signal: AbortSignal): Promise<void> {
    const send = (e: AssistantEvent) => {
      if (!res.writableEnded && !signal.aborted) res.write(serializeSse(e));
    };
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const atlas = await this.config.get<Record<string, string | null>>('atlas.urls');
      const atlasUrls = Object.values(atlas).filter(
        (v): v is string => typeof v === 'string' && v.startsWith('http'),
      );
      const sanitizer = new StreamingSanitizer(atlasUrls);
      const prompt = buildPublicPrompt(dto.message, dto.history, locale);
      for await (const chunk of this.provider.stream(prompt, signal)) {
        const safe = sanitizer.push(chunk);
        if (safe) send({ event: 'delta', data: { text: safe } });
      }
      const rest = sanitizer.flush();
      if (rest) send({ event: 'delta', data: { text: rest } });
      send({ event: 'done', data: {} });
    } catch (err) {
      if (!signal.aborted) {
        this.logger.warn({ provider: this.provider.name, err: (err as Error).message }, 'assistant failed');
        send({ event: 'error', data: { code: 'AI_UNAVAILABLE' } });
      }
    } finally {
      if (!res.writableEnded) res.end();
    }
  }
}
