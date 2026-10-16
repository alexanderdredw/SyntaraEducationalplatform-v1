import { z } from 'zod';
import { type Locale } from '@syntara/shared';

/**
 * Формат базовой программы (BR-CNT-02, docs/CONTENT_GUIDE.md):
 *   content/<раздел>/section.yaml
 *   content/<раздел>/<предмет>/subject.yaml          (content/_root/<предмет>/ — предмет вне разделов)
 *   content/<раздел>/<предмет>/<тема>/{ru.md, kk.md, en.md, quiz.yaml, media/}
 * Длины — ограничения 5.4/5.5; коды — постоянные ключи импорта (BR-CNT-04).
 */

export const CONTENT_LOCALES = ['ru', 'kk', 'en'] as const satisfies readonly Locale[];
/** Каталог предметов вне разделов (эталон U13: «Химия — Доступно»). */
export const ROOT_DIR = '_root';
/** BR-CNT-06: не больше 300 КБ. */
export const MAX_IMAGE_BYTES = 300 * 1024;
export const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
} as const;
export const LICENSES = ['own', 'CC0', 'public-domain'] as const;

export const CODE_RE = /^[a-z0-9][a-z0-9_-]*$/;
const code = z.string().regex(CODE_RE, 'код — латинские строчные буквы, цифры, «-» и «_»');
const text = (max: number) =>
  z.string().trim().min(1, 'не может быть пустым').max(max, `не длиннее ${max} символов`);
const position = z.number().int('целое число').min(1, 'от 1');

/** Тексты по языкам: ru обязателен (BR-CNT-05). */
const localized = (max: number) =>
  z.strictObject({ ru: text(max), kk: text(max).optional(), en: text(max).optional() });
const localizedOptional = (max: number) =>
  z.strictObject({ ru: text(max).optional(), kk: text(max).optional(), en: text(max).optional() });

export const SectionFile = z.strictObject({
  code,
  position,
  title: localized(150),
  description: localizedOptional(1000).optional(),
});
export type SectionFile = z.infer<typeof SectionFile>;

export const SubjectFile = z.strictObject({
  code,
  title: localized(150),
  description: localizedOptional(1000).optional(),
});
export type SubjectFile = z.infer<typeof SubjectFile>;

export const MediaEntry = z.strictObject({
  file: z.string().regex(/^media\/[A-Za-z0-9._-]+$/, 'путь вида media/<имя файла>'),
  source: text(500),
  license: z.enum(LICENSES, `лицензия: ${LICENSES.join(', ')}`),
  author: text(200).optional(),
});
export type MediaEntry = z.infer<typeof MediaEntry>;

const lessonTexts = {
  title: text(150),
  description: text(1000).optional(),
  funFact: text(500).optional(),
  illustrationAlt: text(300).optional(),
};

/** YAML-заголовок ru.md: общие для всех языков поля (код, порядок, иллюстрация, источники картинок). */
export const RuFrontMatter = z.strictObject({
  code,
  position,
  ...lessonTexts,
  illustration: z
    .string()
    .regex(/^media\/[A-Za-z0-9._-]+$/, 'путь вида media/<имя файла>')
    .optional(),
  media: z.array(MediaEntry).optional(),
});
export type RuFrontMatter = z.infer<typeof RuFrontMatter>;

/** YAML-заголовок kk.md / en.md: перевод готовит ИИ и помечает «на проверке» до вычитки (BR-CNT-05). */
export const TranslationFrontMatter = z.strictObject({
  ...lessonTexts,
  review: z.enum(['needs_review', 'reviewed'], 'review: needs_review или reviewed'),
});
export type TranslationFrontMatter = z.infer<typeof TranslationFrontMatter>;

const optionText = localizedOptional(300);
export const QuizQuestion = z.strictObject({
  code,
  type: z.enum(
    ['single_choice', 'true_false', 'text_input'],
    'type: single_choice, true_false или text_input',
  ),
  difficulty: z.enum(['easy', 'medium', 'hard'], 'difficulty: easy, medium или hard'),
  /** Пробный вопрос для гостя на главной (BR-QZ-09, PH-02). */
  demo: z.boolean().optional(),
  text: localized(1000),
  explanation: localizedOptional(2000).optional(),
  options: z.array(z.strictObject({ text: optionText, correct: z.boolean().optional() })).optional(),
  /** true_false: правильный ответ — «Верно» (true) или «Неверно» (false); тексты вариантов задаёт сервер (PH-28). */
  correct: z.boolean().optional(),
  /** text_input: правильный ответ (сравнение — BR-QZ-03). */
  answer: text(300).optional(),
});
export type QuizQuestion = z.infer<typeof QuizQuestion>;

export const QuizFile = z.strictObject({ questions: z.array(QuizQuestion).min(1, 'хотя бы один вопрос') });
export type QuizFile = z.infer<typeof QuizFile>;

/* ---------- Модель после разбора ---------- */

export interface LocaleTexts {
  title: string;
  description?: string;
  funFact?: string;
  bodyMd?: string;
  illustrationAlt?: string;
  needsReview: boolean;
}

export interface SectionModel {
  code: string;
  position: number;
  translations: Partial<Record<Locale, { title: string; description?: string }>>;
  file: string;
}

export interface SubjectModel {
  code: string;
  sectionCode: string | null;
  translations: Partial<Record<Locale, { title: string; description?: string }>>;
  file: string;
}

export interface TopicSectionModel {
  /** Полный код: `<код темы>#<код раздела>`. */
  code: string;
  position: number;
  /** Путь картинки раздела относительно папки темы (media/…). */
  illustration?: string;
  translations: Partial<Record<Locale, { title: string; body?: string; illustrationAlt?: string }>>;
}

export interface QuestionModel {
  /** Полный код: `<код темы>/q/<код вопроса>`. */
  code: string;
  type: 'single_choice' | 'true_false' | 'text_input';
  difficulty: 'easy' | 'medium' | 'hard';
  isDemo: boolean;
  translations: Partial<Record<Locale, { text: string; explanation?: string }>>;
  options: Array<{ isCorrect: boolean; translations: Partial<Record<Locale, string>> }>;
  textAnswer: string | null;
}

export interface MediaModel {
  /** Путь относительно папки темы: media/<файл>. */
  file: string;
  absPath: string;
  mime: string;
  bytes: Buffer;
  sha256: string;
  source: string;
  license: string;
}

export interface TopicModel {
  /** Полный код: `<код предмета>/<код темы>`. */
  code: string;
  subjectCode: string;
  position: number;
  dir: string;
  translations: Partial<Record<Locale, LocaleTexts>>;
  illustration?: string;
  sections: TopicSectionModel[];
  questions: QuestionModel[];
  media: Record<string, MediaModel>;
}

export interface ContentCatalog {
  sections: SectionModel[];
  subjects: SubjectModel[];
  topics: TopicModel[];
}

export interface ContentError {
  /** Путь файла относительно корня репозитория. */
  file: string;
  field?: string;
  message: string;
}

export function formatError(e: ContentError): string {
  return `${e.file}${e.field ? `: ${e.field}` : ''} — ${e.message}`;
}
