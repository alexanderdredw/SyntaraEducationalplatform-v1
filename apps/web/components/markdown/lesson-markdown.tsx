import { type ReactNode } from 'react';
import type { components } from '@/lib/api/schema';
import { SafeMarkdown } from './safe-markdown';

/** Markdown урока, отрисованный заранее: исходный текст → разметка. */
export type LessonMarkdown = Record<string, ReactNode>;

/**
 * Текст урока и разделов — на сервере (OPT-05, О4-4), тем же SafeMarkdown (skipHtml, rehype-sanitize, safeHref —
 * REQ-NFR-SEC-06). Ключ — исходный текст: если данные урока в браузере обновятся, несовпавший текст
 * отрисуется заново через LazyMarkdown, а не покажет старую разметку.
 */
export function lessonMarkdown(lesson: components['schemas']['LessonDto']): LessonMarkdown {
  const out: LessonMarkdown = {};
  for (const text of [lesson.bodyMd, ...lesson.sections.map((s) => s.body)]) {
    if (text && !(text in out)) out[text] = <SafeMarkdown>{text}</SafeMarkdown>;
  }
  return out;
}
