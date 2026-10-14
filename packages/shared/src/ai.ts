import { z } from 'zod';

/** PH-20 `ai.limits.max_chars` и API-PUB-06: сообщение ≤ 2000 символов, история ≤ 20 сообщений. */
export const AI_MAX_MESSAGE_CHARS = 2000;
export const AI_MAX_HISTORY = 20;

export const ChatMessage = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(8000, 'tooLong'),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

/** API-PUB-06 */
export const PublicAssistantDto = z.object({
  message: z.string().trim().min(1, 'required').max(AI_MAX_MESSAGE_CHARS, 'tooLong'),
  history: z.array(ChatMessage).max(AI_MAX_HISTORY, 'tooLong').default([]),
});
export type PublicAssistantDto = z.infer<typeof PublicAssistantDto>;

/** API-PUB-03 */
export const DemoAnswerDto = z.object({
  questionId: z.uuid('required'),
  version: z.string().min(1, 'required').max(64, 'tooLong'),
  optionId: z.uuid('required'),
});
export type DemoAnswerDto = z.infer<typeof DemoAnswerDto>;

/** SSE API-PUB-06: `event: delta {text}` … `event: done {}` / `event: error {code}`. */
export type AssistantEvent =
  | { event: 'delta'; data: { text: string } }
  | { event: 'done'; data: Record<string, never> }
  | { event: 'error'; data: { code: string } };

export function serializeSse(e: AssistantEvent): string {
  return `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
}

/** Разбор потока SSE: возвращает события из буфера и неразобранный остаток. */
export function parseSse(buffer: string): { events: AssistantEvent[]; rest: string } {
  const events: AssistantEvent[] = [];
  const blocks = buffer.split('\n\n');
  const rest = blocks.pop() ?? '';
  for (const block of blocks) {
    let event = '';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (event === 'delta' || event === 'done' || event === 'error') {
      events.push({ event, data: data ? JSON.parse(data) : {} } as AssistantEvent);
    }
  }
  return { events, rest };
}

/**
 * BR-AI-02: в промпт не передаются email и телефоны — они заменяются метками.
 * (ФИО надёжно распознать нельзя; в публичный промпт попадает только переписка гостя без данных профиля.)
 */
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;
const PHONE = /(?:\+?\d[\d ()-]{6,}\d)/g;
export function redactPersonalData(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(PHONE, (m) => (m.replace(/\D/g, '').length >= 7 ? '[phone]' : m));
}

/** Внутренние маршруты раздела 4 (без префикса локали). */
const INTERNAL_ROUTES: RegExp[] = [
  /^\/$/,
  /^\/(subjects|about|ai|schools|support|terms|privacy|cookies|join)$/,
  /^\/schools\/request$/,
  /^\/auth\/(login|start)$/,
  /^\/account\/privacy$/,
  /^\/teacher\/(courses|assignments|classes|subjects\/new)$/,
  /^\/teacher\/(subjects|topics|classes)\/[\w-]+(\/[\w-]+)*$/,
  /^\/learn\/(subjects|assistant|progress|achievements|assignments)$/,
  /^\/learn\/(sections|topics)\/[\w-]+$/,
  /^\/staff\/(tickets|requests)$/,
];

/** BR-AI-07: разрешена ли ссылка — внутренний маршрут раздела 4 или URL атласа из конфигурации. */
export function isAllowedLink(href: string, atlasUrls: readonly string[]): boolean {
  const url = href.trim();
  if (atlasUrls.includes(url)) return true;
  if (!url.startsWith('/') || url.startsWith('//')) return false;
  const [path = '', query = ''] = url.split(/[?#]/);
  if (query && !/^[\w=&%.-]*$/.test(query)) return false;
  const withoutLocale = path.replace(/^\/(ru|kk|en)(?=\/|$)/, '') || '/';
  return INTERNAL_ROUTES.some((re) => re.test(withoutLocale));
}

const MD_LINK = /\[([^\]\n]*)\]\(([^)\s]*)\)/g;
const BARE_URL = /\b(?:https?:\/\/|www\.)[^\s)<>\]]+/gi;
const HTML_TAG = /<\/?[a-z!][^>]*>/gi;

/**
 * Санитизация ответа ИИ (BR-AI-07, REQ-NFR-SEC-06): HTML-теги удаляются, markdown-ссылки на
 * неразрешённые адреса заменяются своим текстом, «голые» внешние URL удаляются.
 */
export function sanitizeAssistantText(text: string, atlasUrls: readonly string[]): string {
  return text
    .replace(HTML_TAG, '')
    .replace(MD_LINK, (_, label: string, href: string) =>
      isAllowedLink(href, atlasUrls) ? `[${label}](${href})` : label,
    )
    .replace(BARE_URL, (url) => (atlasUrls.includes(url) ? url : ''));
}

/**
 * Потоковая санитизация: части ответа приходят кусками, ссылка или тег могут оборваться на границе.
 * Незавершённый хвост (открытая «[», «<» или начатый URL) придерживается до следующей части.
 */
export class StreamingSanitizer {
  private buffer = '';

  constructor(private readonly atlasUrls: readonly string[]) {}

  push(chunk: string): string {
    this.buffer += chunk;
    const cut = this.safeCut();
    const ready = this.buffer.slice(0, cut);
    this.buffer = this.buffer.slice(cut);
    return sanitizeAssistantText(ready, this.atlasUrls);
  }

  flush(): string {
    const rest = this.buffer;
    this.buffer = '';
    return sanitizeAssistantText(rest, this.atlasUrls);
  }

  private safeCut(): number {
    const b = this.buffer;
    let cut = b.length;
    const openBracket = b.lastIndexOf('[');
    if (openBracket >= 0 && !/^\[[^\]\n]*\]\([^)\s]*\)/.test(b.slice(openBracket))) {
      // Открытая скобка без завершённой ссылки; «[текст]» без «(» тоже ждём — следом может прийти адрес.
      const closed = /^\[[^\]\n]*\][^(]/.test(b.slice(openBracket));
      if (!closed) cut = Math.min(cut, openBracket);
    }
    const openTag = b.lastIndexOf('<');
    if (openTag >= 0 && !b.slice(openTag).includes('>')) cut = Math.min(cut, openTag);
    const lastSpace = Math.max(b.lastIndexOf(' '), b.lastIndexOf('\n'));
    const tail = b.slice(lastSpace + 1);
    if (/^(h|ht|htt|http|https?:?\/{0,2}|w|ww|www\.?)/i.test(tail) || /:\/\//.test(tail)) {
      cut = Math.min(cut, lastSpace + 1);
    }
    return cut;
  }
}
