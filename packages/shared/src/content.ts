import { z } from 'zod';
import { Locale, type Locale as LocaleType } from './enums';

/**
 * Итерация 7: кабинет учителя — предметы, темы, публикация, файлы (6.4, 7.8, 8.3).
 * Сообщения ошибок — ключи i18n `validation.*`.
 */

/** PH-23 `limits` (значения из seed config.json; те же ограничения — CHECK в 5.4/5.5). */
export const CONTENT_LIMITS = {
  title: 150,
  description: 1000,
  funFact: 500,
  bodyMd: 50000,
  question: 1000,
  option: 300,
  explanation: 2000,
  minOptions: 2,
  /** REQ-TCH-QZ-02: 2–8 вариантов. */
  maxOptions: 8,
  /** REQ-TCH-PUB-03 */
  changeNote: 500,
} as const;

/** BR-FILE-01, BR-FILE-02 (1 МБ = 1 048 576 байт). */
export const FILE_LIMITS = {
  coverMaxBytes: 5 * 1_048_576,
  materialMaxBytes: 25 * 1_048_576,
  materialsPerTopic: 20,
  materialsBytesPerTopic: 200 * 1_048_576,
  /** BR-FILE-04: срок подписанной ссылки. */
  signedUrlSeconds: 10 * 60,
} as const;

/** BR-FILE-01 */
export const COVER_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

/**
 * BR-FILE-02: расширение → допустимые MIME (сигнатура проверяется отдельно). Таблиц (XLSX, CSV и др.) нет —
 * BR-FILE-09, `spreadsheet.ts`.
 */
export const MATERIAL_TYPES = {
  pdf: ['application/pdf'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  odt: ['application/vnd.oasis.opendocument.text'],
  txt: ['text/plain'],
} as const satisfies Record<string, readonly string[]>;
export type MaterialExtension = keyof typeof MATERIAL_TYPES;

export const extensionOf = (fileName: string): string =>
  /\.([a-z0-9]+)$/i.exec(fileName.trim())?.[1]?.toLowerCase() ?? '';

/** Необязательная строка: пробелы обрезаются, пустая — как отсутствующая. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, 'tooLong')
    .optional()
    .transform((v) => v || undefined);

/**
 * «Заполни хотя бы один язык (RU, KK или EN)» (REQ-TCH-SUBJ-02, REQ-TCH-QZ-03): язык, в котором что-то
 * введено, должен иметь название; хотя бы один язык должен быть заполнен. Пустые языки отбрасываются.
 */
function translationsRefine<T extends { title?: string }>(
  translations: Partial<Record<LocaleType, T>>,
  ctx: z.RefinementCtx,
  hasContent: (t: T) => boolean,
): void {
  let filled = 0;
  for (const [locale, t] of Object.entries(translations) as Array<[LocaleType, T | undefined]>) {
    if (!t || !hasContent(t)) continue;
    filled += 1;
    if (!t.title)
      ctx.addIssue({ code: 'custom', path: ['translations', locale, 'title'], message: 'required' });
  }
  if (filled === 0) ctx.addIssue({ code: 'custom', path: ['translations'], message: 'atLeastOneLanguage' });
}

/** Только заполненные языки (после валидации). */
export function filledTranslations<T extends object>(
  translations: Partial<Record<LocaleType, T>>,
): Array<[LocaleType, T]> {
  return (Object.entries(translations) as Array<[LocaleType, T | undefined]>).filter(
    (e): e is [LocaleType, T] =>
      e[1] !== undefined && Object.values(e[1] as object).some((v) => v !== undefined),
  );
}

const SubjectLang = z.object({
  title: optionalText(CONTENT_LIMITS.title),
  description: optionalText(CONTENT_LIMITS.description),
});

/** API-T-02 / API-T-03 (PATCH — те же поля): минимум один язык с названием (REQ-TCH-SUBJ-02, PH-23). */
export const SubjectDto = z
  .object({
    translations: z.partialRecord(Locale, SubjectLang),
    inPublicCatalog: z.boolean().default(false),
  })
  .superRefine((d, ctx) => translationsRefine(d.translations, ctx, (t) => Boolean(t.title || t.description)));
export type SubjectDto = z.infer<typeof SubjectDto>;

/** API-T-07 */
export const GrantAccessDto = z.object({ classId: z.uuid('required') });
export type GrantAccessDto = z.infer<typeof GrantAccessDto>;

const TopicLang = z.object({
  title: optionalText(CONTENT_LIMITS.title),
  description: optionalText(CONTENT_LIMITS.description),
  funFact: optionalText(CONTENT_LIMITS.funFact),
  bodyMd: optionalText(CONTENT_LIMITS.bodyMd),
});
export type TopicLang = z.infer<typeof TopicLang>;

/**
 * Ссылка на обложку (REQ-TCH-TOP-04, BR-FILE-06): только http(s). При сохранении сервер скачивает картинку
 * в своё хранилище; ученику внешняя ссылка не отдаётся.
 */
const coverUrl = z
  .string()
  .trim()
  .max(2000, 'tooLong')
  .refine((v) => v === '' || /^https?:\/\/[^\s]+$/i.test(v), 'invalidUrl')
  .transform((v) => v || null)
  .nullable()
  .optional();

/**
 * API-T-10 (сохранение без смены статуса, REQ-TCH-TOP-06): переводы, обложка — файл из галереи или ссылка
 * (выбор — последнее действие, PH-26: клиент присылает что-то одно), материалы в порядке показа.
 */
export const TopicContentDto = z
  .object({
    translations: z.partialRecord(Locale, TopicLang),
    coverMediaId: z.uuid('invalidFile').nullable().optional(),
    coverUrl,
    materialIds: z
      .array(z.uuid('invalidFile'))
      .max(FILE_LIMITS.materialsPerTopic, 'tooManyFiles')
      .refine((ids) => new Set(ids).size === ids.length, 'invalidFile')
      .default([]),
  })
  .superRefine((d, ctx) => {
    translationsRefine(d.translations, ctx, (t) => Object.values(t).some(Boolean));
    if (d.coverMediaId && d.coverUrl)
      ctx.addIssue({ code: 'custom', path: ['coverUrl'], message: 'coverConflict' });
  });
export type TopicContentDto = z.infer<typeof TopicContentDto>;

/** API-T-11: название из формы (ещё не сохранённое) — основа черновика. */
export const AiDraftDto = z.object({ title: optionalText(CONTENT_LIMITS.title) });
export type AiDraftDto = z.infer<typeof AiDraftDto>;

/** API-T-11: ответ — RU и KK (REQ-TCH-TOP-02), включая название на языке черновика (решение владельца 2026-10-16). */
export const AiDraftLang = z.object({
  title: z.string().trim().min(1).max(CONTENT_LIMITS.title),
  description: z.string().max(CONTENT_LIMITS.description),
  funFact: z.string().max(CONTENT_LIMITS.funFact),
  bodyMd: z.string().max(CONTENT_LIMITS.bodyMd),
});
export const AiDraftResult = z.object({ ru: AiDraftLang, kk: AiDraftLang });
export type AiDraftResult = z.infer<typeof AiDraftResult>;

/** API-T-12: «Что изменилось (необязательно)» ≤ 500 (REQ-TCH-PUB-03). */
export const PublishDto = z.object({ changeNote: optionalText(CONTENT_LIMITS.changeNote) });
export type PublishDto = z.infer<typeof PublishDto>;

/** API-T-16: лимиты BR-FILE-01/02 проверяются до выдачи ссылки; материал привязан к теме (лимит на тему). */
export const UploadUrlDto = z
  .object({
    kind: z.enum(['cover', 'material']),
    topicId: z.uuid('invalidFile').optional(),
    fileName: z.string().trim().min(1, 'required').max(255, 'tooLong'),
    mime: z.string().trim().min(1, 'required').max(200, 'tooLong'),
    size: z.number().int().positive('required'),
  })
  .superRefine((d, ctx) => {
    if (d.kind === 'material' && !d.topicId)
      ctx.addIssue({ code: 'custom', path: ['topicId'], message: 'required' });
  });
export type UploadUrlDto = z.infer<typeof UploadUrlDto>;

/**
 * Снимок опубликованной темы (topic_versions.snapshot, SM-TOPIC): ученик видит только его (REQ-TCH-PUB-05).
 * Поля обложки и материалов появились в итерации 7 — в снимках seed их нет.
 */
export interface TopicSnapshot {
  /** Базовый урок из content/: постоянный код и хеш содержимого (BR-CNT-04). */
  code?: string;
  contentHash?: string;
  translations: Partial<
    Record<
      LocaleType,
      {
        title: string;
        description?: string;
        funFact?: string;
        bodyMd?: string;
        summary?: string;
        /** Подпись иллюстрации темы (базовые уроки). */
        illustrationAlt?: string;
        /** Перевод ждёт вычитки человеком (BR-CNT-05). */
        needsReview?: boolean;
      }
    >
  >;
  sections: Array<{
    id: string;
    code?: string;
    position: number;
    illustrationMediaId?: string | null;
    translations: Partial<Record<LocaleType, { title: string; body?: string; illustrationAlt?: string }>>;
  }>;
  coverMediaId?: string | null;
  coverUrl?: string | null;
  materialIds?: string[];
}
