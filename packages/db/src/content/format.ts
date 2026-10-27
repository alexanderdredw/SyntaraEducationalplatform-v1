import { z } from 'zod';
import { ELEMENT_FAMILIES, type Locale, SUBJECT_MODULES, type SubjectModule } from '@syntara/shared';

/**
 * Формат базовой программы (BR-CNT-02, docs/CONTENT_GUIDE.md):
 *   content/<раздел>/section.yaml
 *   content/<раздел>/<предмет>/subject.yaml          (порядок предмета в разделе — position)
 *   content/<раздел>/<предмет>/<тема>/{ru.md, kk.md, en.md, quiz.yaml, media/}
 * Длины — ограничения 5.4/5.5; коды — постоянные ключи импорта (BR-CNT-04).
 */

export const CONTENT_LOCALES = ['ru', 'kk', 'en'] as const satisfies readonly Locale[];
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

/** Глава предмета (BR-CHAP-01): код, порядок, название на языках (KK/EN — с пометкой проверки). */
export const ChapterEntry = z.strictObject({
  code,
  position,
  title: localized(150),
  review: z
    .strictObject({
      kk: z.enum(['needs_review', 'reviewed']).optional(),
      en: z.enum(['needs_review', 'reviewed']).optional(),
    })
    .optional(),
});
export type ChapterEntry = z.infer<typeof ChapterEntry>;

export const SubjectFile = z.strictObject({
  code,
  /** Порядок в разделе каталога (решение владельца 2026-10-17). */
  position,
  title: localized(150),
  description: localizedOptional(1000).optional(),
  /** Главы (BR-CHAP-01): необязательно; если есть — у каждой темы обязателен chapter. */
  chapters: z.array(ChapterEntry).min(1, 'хотя бы одна глава').optional(),
  /** Блоки страницы предмета (REQ-PTBL-01): periodic-table — таблица Менделеева над главами. */
  blocks: z.array(z.enum(['periodic-table'], 'блок: periodic-table')).optional(),
  /** Модуль со своим интерфейсом (REQ-ATL-01): atlas-chemistry — «Mendeleev Atlas». */
  module: z.enum(SUBJECT_MODULES, `модуль: ${SUBJECT_MODULES.join(', ')}`).optional(),
});
export type SubjectFile = z.infer<typeof SubjectFile>;

const review = z.enum(['needs_review', 'reviewed'], 'review: needs_review или reviewed');

/**
 * glossary.yaml в папке предмета (REQ-GLOS-01): разделы с терминами; RU обязателен, KK и EN — с пометкой проверки
 * (без review — needs_review). Коды — постоянные ключи импорта: разделов и терминов — в предмете.
 */
export const GlossaryFile = z.strictObject({
  review: z.strictObject({ kk: review.optional(), en: review.optional() }).optional(),
  sections: z
    .array(
      z.strictObject({
        code,
        position,
        title: localized(150),
        terms: z
          .array(z.strictObject({ code, term: localized(150), definition: localized(1000) }))
          .min(1, 'хотя бы один термин'),
      }),
    )
    .min(1, 'хотя бы один раздел'),
});
export type GlossaryFile = z.infer<typeof GlossaryFile>;

const year = z.number().int('целое число').min(1, 'год').max(2100, 'год');

/** timeline.yaml в папке темы (REQ-TL-01): события с реальными годами; section — код раздела урока. */
export const TimelineFile = z.strictObject({
  events: z
    .array(
      z.strictObject({
        year,
        section: code,
        title: localized(200),
        /** Годы жизни — в подписи точки (решение владельца В-13). */
        lived: z.strictObject({ from: year, to: year }).optional(),
      }),
    )
    .min(1, 'хотя бы одно событие'),
});
export type TimelineFile = z.infer<typeof TimelineFile>;

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
  /** Порядок темы в предмете, а если у предмета есть главы — внутри главы (BR-CHAP-02). */
  position,
  /** Код главы из subject.yaml (BR-CHAP-01). */
  chapter: code.optional(),
  /** Химический элемент урока (REQ-PTBL-04): ячейка таблицы Менделеева ведёт на урок. */
  element: z
    .strictObject({
      symbol: z.string().regex(/^[A-Z][a-z]{0,2}$/, 'символ элемента, например O или Fe'),
      number: z.number().int('целое число').min(1, 'от 1').max(118, 'до 118'),
      group: z.enum(ELEMENT_FAMILIES, `семейство: ${ELEMENT_FAMILIES.join(', ')}`),
      /** Цвет элемента в модуле атласа (REQ-ATL-04, решение А-16): подсветка карточки и картинки. */
      color: z
        .string()
        .regex(/^#[0-9A-F]{6}$/, 'цвет вида #RRGGBB (заглавные буквы)')
        .optional(),
    })
    .optional(),
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

export interface ChapterModel {
  code: string;
  position: number;
  translations: Partial<Record<Locale, { title: string; needsReview: boolean }>>;
}

export interface GlossaryModel {
  file: string;
  sections: Array<{
    code: string;
    position: number;
    translations: Partial<Record<Locale, { title: string; needsReview: boolean }>>;
    terms: Array<{
      code: string;
      position: number;
      translations: Partial<Record<Locale, { term: string; definition: string; needsReview: boolean }>>;
    }>;
  }>;
}

export interface SubjectModel {
  code: string;
  sectionCode: string;
  position: number;
  translations: Partial<Record<Locale, { title: string; description?: string }>>;
  /** Главы по position; пусто — предмет без глав (BR-CHAP-02). */
  chapters: ChapterModel[];
  /** Глоссарий (REQ-GLOS-01); нет файла — нет глоссария. */
  glossary?: GlossaryModel;
  /** Блоки страницы (REQ-PTBL-01). */
  blocks: string[];
  /** Модуль со своим интерфейсом (REQ-ATL-01); нет — стандартная страница предмета. */
  module?: SubjectModule;
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
  /** Сквозной порядок в предмете («Тема N»): у предмета с главами — по главам, затем по position в главе. */
  position: number;
  /** Код главы (без кода предмета); у предмета без глав — нет. */
  chapterCode?: string;
  /** Номер химического элемента (REQ-PTBL-04). */
  elementNumber?: number;
  /** Цвет элемента в модуле атласа (REQ-ATL-04). */
  elementColor?: string;
  dir: string;
  translations: Partial<Record<Locale, LocaleTexts>>;
  illustration?: string;
  sections: TopicSectionModel[];
  /** Лента времени (REQ-TL-01): события по году. */
  timeline?: Array<{
    year: number;
    section: string;
    lived?: { from: number; to: number };
    translations: Partial<Record<Locale, { title: string }>>;
  }>;
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
