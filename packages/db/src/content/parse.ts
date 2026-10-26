import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { type z } from 'zod';
import { isSpreadsheetContent, isSpreadsheetName, type Locale, QuestionDto } from '@syntara/shared';
import {
  type ContentCatalog,
  type ContentError,
  CONTENT_LOCALES,
  IMAGE_TYPES,
  type LocaleTexts,
  MAX_IMAGE_BYTES,
  type MediaModel,
  type QuestionModel,
  QuizFile,
  RuFrontMatter,
  SectionFile,
  type SectionModel,
  SubjectFile,
  type SubjectModel,
  type TopicModel,
  type TopicSectionModel,
  TranslationFrontMatter,
} from './format';
import { imageMatches } from './images';

/**
 * Чтение и проверка папки content/ без обращения к БД (BR-CNT-02, BR-CNT-03, BR-CNT-06): все ошибки собираются
 * сразу, чтобы автор увидел их одним списком; при любой ошибке импорт ничего не пишет.
 */
export function readContent(
  dir: string,
  repoRoot: string,
): { catalog: ContentCatalog; errors: ContentError[] } {
  const errors: ContentError[] = [];
  const rel = (p: string) => relative(repoRoot, p).split(sep).join('/');
  const catalog: ContentCatalog = { sections: [], subjects: [], topics: [] };
  if (!existsSync(dir)) {
    errors.push({ file: rel(dir), message: 'папка не найдена' });
    return { catalog, errors };
  }

  const dirs = (p: string) =>
    readdirSync(p)
      .filter((n) => !n.startsWith('.') && statSync(join(p, n)).isDirectory())
      .sort();
  const files = (p: string) =>
    readdirSync(p)
      .filter((n) => !n.startsWith('.') && statSync(join(p, n)).isFile())
      .sort();

  const yamlFile = <T>(path: string, schema: z.ZodType<T>): T | null => {
    let data: unknown;
    try {
      data = parseYaml(readFileSync(path, 'utf8'));
    } catch (err) {
      errors.push({ file: rel(path), message: `YAML не читается: ${(err as Error).message.split('\n')[0]}` });
      return null;
    }
    return validate(rel(path), data, schema);
  };
  const validate = <T>(file: string, data: unknown, schema: z.ZodType<T>): T | null => {
    const parsed = schema.safeParse(data ?? {});
    if (parsed.success) return parsed.data;
    for (const issue of parsed.error.issues) {
      errors.push({ file, field: issue.path.join('.') || undefined, message: issueMessage(issue) });
    }
    return null;
  };

  // BR-FILE-09: табличные файлы в content/ запрещены — по расширению и по содержимому (xlsx под видом .docx).
  const spreadsheets = (p: string): void => {
    for (const name of readdirSync(p).sort()) {
      const abs = join(p, name);
      if (statSync(abs).isDirectory()) spreadsheets(abs);
      else if (isSpreadsheetName(name) || isSpreadsheetContent(readFileSync(abs)))
        errors.push({
          file: rel(abs),
          message:
            'табличный файл запрещён (BR-FILE-09): таблицы Excel и CSV загружать нельзя, сохрани файл в PDF',
        });
    }
  };
  spreadsheets(dir);

  for (const sectionDir of dirs(dir)) {
    const sectionPath = join(dir, sectionDir);
    const sectionFile = join(sectionPath, 'section.yaml');
    if (!existsSync(sectionFile)) {
      errors.push({ file: rel(sectionPath), message: 'нет section.yaml' });
      continue;
    }
    const section = yamlFile(sectionFile, SectionFile);
    if (!section) continue;
    const sectionCode = section.code;
    catalog.sections.push({
      code: section.code,
      position: section.position,
      translations: translations(section.title, section.description),
      file: rel(sectionFile),
    } satisfies SectionModel);
    for (const subjectDir of dirs(sectionPath)) {
      const subjectPath = join(sectionPath, subjectDir);
      const file = join(subjectPath, 'subject.yaml');
      if (!existsSync(file)) {
        errors.push({ file: rel(subjectPath), message: 'нет subject.yaml' });
        continue;
      }
      const data = yamlFile(file, SubjectFile);
      if (!data) continue;
      catalog.subjects.push({
        code: data.code,
        sectionCode,
        position: data.position,
        translations: translations(data.title, data.description),
        file: rel(file),
      } satisfies SubjectModel);
      for (const topicDir of dirs(subjectPath)) {
        const topic = readTopic(join(subjectPath, topicDir), data.code, rel, errors, validate);
        if (topic) catalog.topics.push(topic);
      }
    }
  }
  for (const name of files(dir)) {
    if (name !== 'README.md')
      errors.push({ file: rel(join(dir, name)), message: 'лишний файл в корне content/' });
  }

  checkUnique(catalog.sections, (s) => s.code, 'code', 'код раздела повторяется', errors);
  checkUnique(catalog.subjects, (s) => s.code, 'code', 'код предмета повторяется', errors);
  checkUnique(catalog.topics, (t) => t.code, 'code', 'код темы повторяется', errors);
  checkUnique(
    catalog.sections,
    (s) => String(s.position),
    'position',
    'порядковый номер раздела повторяется',
    errors,
  );
  checkUnique(
    catalog.subjects,
    (s) => `${s.sectionCode}#${s.position}`,
    'position',
    'порядковый номер предмета в разделе повторяется',
    errors,
  );
  checkUnique(
    catalog.topics,
    (t) => `${t.subjectCode}#${t.position}`,
    'position',
    'порядковый номер темы в предмете повторяется',
    errors,
  );
  return { catalog, errors };
}

function translations(
  title: Partial<Record<Locale, string>>,
  description?: Partial<Record<Locale, string>>,
): SectionModel['translations'] {
  const result: SectionModel['translations'] = {};
  for (const l of CONTENT_LOCALES) {
    const t = title[l];
    if (t) result[l] = { title: t, ...(description?.[l] ? { description: description[l] } : {}) };
  }
  return result;
}

function checkUnique<T extends { file?: string; dir?: string }>(
  items: T[],
  key: (item: T) => string,
  field: string,
  message: string,
  errors: ContentError[],
): void {
  const seen = new Map<string, T>();
  for (const item of items) {
    const k = key(item);
    const prev = seen.get(k);
    if (prev)
      errors.push({
        file: item.file ?? item.dir ?? '',
        field,
        message: `${message}: ${k} (уже в ${prev.file ?? prev.dir})`,
      });
    else seen.set(k, item);
  }
}

function issueMessage(issue: z.core.$ZodIssue): string {
  if (issue.code === 'invalid_type' && issue.input === undefined) return 'обязательное поле';
  if (issue.code === 'unrecognized_keys') return `неизвестные поля: ${issue.keys.join(', ')}`;
  if (issue.code === 'invalid_type') return `ожидается ${issue.expected}`;
  return issue.message;
}

const HEADING_RE = /^##\s+(.+?)\s*\{#([a-z0-9][a-z0-9_-]*)\}\s*$/;
const IMAGE_LINE_RE = /^!\[([^\]]*)\]\((media\/[A-Za-z0-9._-]+)\)\s*$/;

interface ParsedDoc {
  front: unknown;
  bodyMd?: string;
  sections: Array<{ code: string; title: string; body?: string; image?: { file: string; alt: string } }>;
}

/** Markdown с YAML-заголовком: текст до первого «## …» — текст урока; «## Название {#код}» — раздел аккордеона. */
function parseDoc(file: string, raw: string, errors: ContentError[]): ParsedDoc | null {
  const src = raw.replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(src);
  if (!m) {
    errors.push({ file, message: 'нет YAML-заголовка между строками «---»' });
    return null;
  }
  let front: unknown;
  try {
    front = parseYaml(m[1]!);
  } catch (err) {
    errors.push({ file, message: `YAML-заголовок не читается: ${(err as Error).message.split('\n')[0]}` });
    return null;
  }
  const lines = m[2]!.split('\n');
  const intro: string[] = [];
  const sections: ParsedDoc['sections'] = [];
  let current: {
    code: string;
    title: string;
    lines: string[];
    image?: { file: string; alt: string };
  } | null = null;
  let fence = false;
  lines.forEach((line, i) => {
    const at = `строка ${i + 1} после заголовка`;
    if (line.startsWith('```')) fence = !fence;
    if (!fence && /^#\s/.test(line)) {
      errors.push({
        file,
        field: at,
        message: 'заголовок первого уровня не нужен: название темы — в поле title',
      });
      return;
    }
    if (!fence && line.startsWith('## ')) {
      const h = HEADING_RE.exec(line);
      if (!h) {
        errors.push({ file, field: at, message: 'у раздела нет кода: «## Название {#код}»' });
        return;
      }
      if (current) sections.push(finish(current));
      current = { code: h[2]!, title: h[1]!, lines: [] };
      return;
    }
    const img = fence ? null : IMAGE_LINE_RE.exec(line);
    if (img) {
      if (!current) {
        errors.push({
          file,
          field: at,
          message: 'картинка вне раздела: иллюстрация темы — в поле illustration',
        });
      } else if (current.image) {
        errors.push({ file, field: at, message: 'в разделе больше одной картинки' });
      } else if (!img[1]!.trim()) {
        errors.push({ file, field: at, message: 'у картинки нет подписи: ![подпись](media/файл)' });
      } else {
        current.image = { file: img[2]!, alt: img[1]!.trim() };
      }
      return;
    }
    if (!fence && line.includes('![')) {
      errors.push({
        file,
        field: at,
        message: 'картинка — только отдельной строкой ![подпись](media/файл) в разделе',
      });
      return;
    }
    (current ? current.lines : intro).push(line);
  });
  if (current) sections.push(finish(current));
  const bodyMd = intro.join('\n').trim();
  if (bodyMd.length > 50000) errors.push({ file, message: 'текст урока длиннее 50 000 символов' });
  for (const s of sections) {
    if (s.title.length > 200)
      errors.push({ file, field: `## ${s.code}`, message: 'название раздела длиннее 200 символов' });
    if ((s.body?.length ?? 0) > 20000)
      errors.push({ file, field: `## ${s.code}`, message: 'текст раздела длиннее 20 000 символов' });
  }
  checkUnique(
    sections.map((s) => ({ ...s, file })),
    (s) => s.code,
    'разделы',
    'код раздела повторяется',
    errors,
  );
  return { front, ...(bodyMd ? { bodyMd } : {}), sections };

  function finish(c: {
    code: string;
    title: string;
    lines: string[];
    image?: { file: string; alt: string };
  }) {
    const body = c.lines.join('\n').trim();
    return {
      code: c.code,
      title: c.title,
      ...(body ? { body } : {}),
      ...(c.image ? { image: c.image } : {}),
    };
  }
}

type Validate = <T>(file: string, data: unknown, schema: z.ZodType<T>) => T | null;

function readTopic(
  topicPath: string,
  subjectCode: string,
  rel: (p: string) => string,
  errors: ContentError[],
  validate: Validate,
): TopicModel | null {
  const dirRel = rel(topicPath);
  const known = new Set(['ru.md', 'kk.md', 'en.md', 'quiz.yaml', 'media']);
  for (const name of readdirSync(topicPath).filter((n) => !n.startsWith('.'))) {
    if (!known.has(name)) errors.push({ file: `${dirRel}/${name}`, message: 'лишний файл в папке темы' });
  }
  const ruPath = join(topicPath, 'ru.md');
  if (!existsSync(ruPath)) {
    errors.push({ file: dirRel, message: 'нет ru.md — русская версия обязательна (BR-CNT-05)' });
    return null;
  }

  const docs: Partial<Record<Locale, ParsedDoc>> = {};
  for (const l of CONTENT_LOCALES) {
    const p = join(topicPath, `${l}.md`);
    if (existsSync(p)) {
      const doc = parseDoc(rel(p), readFileSync(p, 'utf8'), errors);
      if (doc) docs[l] = doc;
    }
  }
  if (!docs.ru) return null;
  const ru = validate(rel(ruPath), docs.ru.front, RuFrontMatter);
  if (!ru) return null;
  const code = `${subjectCode}/${ru.code}`;

  const topic: TopicModel = {
    code,
    subjectCode,
    position: ru.position,
    dir: dirRel,
    translations: {},
    ...(ru.illustration ? { illustration: ru.illustration } : {}),
    sections: [],
    questions: [],
    media: {},
  };
  const texts = (
    t: { title: string; description?: string; funFact?: string; illustrationAlt?: string },
    doc: ParsedDoc,
    needsReview: boolean,
  ): LocaleTexts => ({
    title: t.title,
    ...(t.description ? { description: t.description } : {}),
    ...(t.funFact ? { funFact: t.funFact } : {}),
    ...(doc.bodyMd ? { bodyMd: doc.bodyMd } : {}),
    ...(t.illustrationAlt ? { illustrationAlt: t.illustrationAlt } : {}),
    needsReview,
  });
  topic.translations.ru = texts(ru, docs.ru, false);
  for (const l of ['kk', 'en'] as const) {
    const doc = docs[l];
    if (!doc) continue;
    const t = validate(rel(join(topicPath, `${l}.md`)), doc.front, TranslationFrontMatter);
    if (t) topic.translations[l] = texts(t, doc, t.review === 'needs_review');
  }
  if (ru.illustration && !ru.illustrationAlt)
    errors.push({ file: rel(ruPath), field: 'illustrationAlt', message: 'у иллюстрации нет подписи' });

  // Разделы аккордеона: связь языков — по коду раздела; порядок — как в ru.md, затем разделы других языков.
  const byCode = new Map<string, TopicSectionModel>();
  for (const l of CONTENT_LOCALES) {
    for (const s of docs[l]?.sections ?? []) {
      let section = byCode.get(s.code);
      if (!section) {
        section = { code: `${code}#${s.code}`, position: byCode.size + 1, translations: {} };
        byCode.set(s.code, section);
      }
      if (s.image) {
        if (section.illustration && section.illustration !== s.image.file)
          errors.push({
            file: rel(join(topicPath, `${l}.md`)),
            field: `## ${s.code}`,
            message: `картинка раздела отличается от другого языка (${section.illustration})`,
          });
        section.illustration = s.image.file;
      }
      section.translations[l] = {
        title: s.title,
        ...(s.body ? { body: s.body } : {}),
        ...(s.image ? { illustrationAlt: s.image.alt } : {}),
      };
    }
  }
  topic.sections = [...byCode.values()];

  // Картинки: только media/ папки темы, объявленные в ru.md с источником и лицензией (BR-CNT-06).
  const declared = new Map((ru.media ?? []).map((m) => [m.file, m]));
  const used = new Set<string>([
    ...(ru.illustration ? [ru.illustration] : []),
    ...topic.sections.flatMap((s) => (s.illustration ? [s.illustration] : [])),
  ]);
  const mediaDir = join(topicPath, 'media');
  const onDisk = existsSync(mediaDir)
    ? readdirSync(mediaDir)
        .filter((n) => !n.startsWith('.'))
        .map((n) => `media/${n}`)
    : [];
  for (const file of onDisk) {
    if (!used.has(file))
      errors.push({ file: `${dirRel}/${file}`, message: 'картинка не используется в уроке' });
  }
  for (const file of used) {
    const abs = join(topicPath, file);
    const entry = declared.get(file);
    if (!existsSync(abs)) {
      errors.push({ file: dirRel, field: file, message: 'файл картинки не найден' });
      continue;
    }
    if (!entry) {
      errors.push({ file: rel(ruPath), field: 'media', message: `нет источника и лицензии для ${file}` });
      continue;
    }
    const mime = IMAGE_TYPES[extname(file).toLowerCase() as keyof typeof IMAGE_TYPES];
    const bytes = readFileSync(abs);
    if (!mime) {
      errors.push({ file: `${dirRel}/${file}`, message: 'допустимы только WEBP, PNG и JPG' });
      continue;
    }
    if (bytes.length > MAX_IMAGE_BYTES)
      errors.push({
        file: `${dirRel}/${file}`,
        message: `больше 300 КБ (${Math.ceil(bytes.length / 1024)} КБ)`,
      });
    if (!imageMatches(bytes, mime))
      errors.push({ file: `${dirRel}/${file}`, message: 'содержимое файла не совпадает с расширением' });
    topic.media[file] = {
      file,
      absPath: abs,
      mime,
      bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      source: entry.source,
      license: entry.license,
    } satisfies MediaModel;
  }
  for (const file of declared.keys()) {
    if (!used.has(file))
      errors.push({ file: rel(ruPath), field: 'media', message: `${file} объявлен, но не используется` });
  }

  // Квиз (необязателен): правила вопросов — как у учителя (QuestionDto, BR-QZ-02).
  const quizPath = join(topicPath, 'quiz.yaml');
  if (existsSync(quizPath)) {
    const file = rel(quizPath);
    let data: unknown;
    try {
      data = parseYaml(readFileSync(quizPath, 'utf8'));
    } catch (err) {
      errors.push({ file, message: `YAML не читается: ${(err as Error).message.split('\n')[0]}` });
    }
    const quiz = data === undefined ? null : validate(file, data, QuizFile);
    const locales = CONTENT_LOCALES.filter((l) => topic.translations[l]);
    quiz?.questions.forEach((q, i) => {
      const at = `questions.${i} (${q.code})`;
      const question: QuestionModel = {
        code: `${code}/q/${q.code}`,
        type: q.type,
        difficulty: q.difficulty,
        isDemo: q.demo ?? false,
        translations: {},
        options: [],
        textAnswer: null,
      };
      for (const l of CONTENT_LOCALES) {
        const t = q.text[l];
        if (!t) continue;
        question.translations[l] = {
          text: t,
          ...(q.explanation?.[l] ? { explanation: q.explanation[l] } : {}),
        };
      }
      if (q.type === 'single_choice') {
        if (q.correct !== undefined || q.answer !== undefined)
          errors.push({
            file,
            field: at,
            message: 'для single_choice правильный вариант — correct: true у варианта',
          });
        question.options = (q.options ?? []).map((o) => ({
          isCorrect: o.correct ?? false,
          translations: Object.fromEntries(
            CONTENT_LOCALES.flatMap((l) => (o.text[l] ? [[l, o.text[l]]] : [])),
          ),
        }));
      } else if (q.type === 'true_false') {
        if (q.correct === undefined)
          errors.push({
            file,
            field: at,
            message: 'для true_false нужно correct: true («Верно») или false («Неверно»)',
          });
        if (q.options || q.answer !== undefined)
          errors.push({
            file,
            field: at,
            message: 'для true_false варианты не пишутся — их задаёт платформа',
          });
        question.options = [
          { isCorrect: q.correct === true, translations: {} },
          { isCorrect: q.correct === false, translations: {} },
        ];
      } else {
        if (!q.answer) errors.push({ file, field: at, message: 'для text_input нужен answer' });
        if (q.options || q.correct !== undefined)
          errors.push({ file, field: at, message: 'для text_input варианты не пишутся' });
        question.textAnswer = q.answer ?? null;
      }
      // Те же правила, что у вопроса учителя (QuestionDto: 2–8 вариантов, ровно один правильный).
      const dto = QuestionDto.safeParse({
        type: q.type,
        difficulty: q.difficulty,
        translations: question.translations,
        options: question.options.map((o) => ({ isCorrect: o.isCorrect, translations: o.translations })),
        ...(question.textAnswer ? { textAnswer: question.textAnswer } : {}),
      });
      if (!dto.success)
        for (const issue of dto.error.issues)
          errors.push({
            file,
            field: `${at}.${issue.path.join('.')}`,
            message: QUESTION_MESSAGES[issue.message] ?? issue.message,
          });
      // Языки квиза совпадают с языками урока: у каждого вопроса и варианта есть текст на каждом языке урока.
      for (const l of CONTENT_LOCALES) {
        const lesson = locales.includes(l);
        const has = Boolean(q.text[l]);
        if (lesson && !has)
          errors.push({ file, field: `${at}.text.${l}`, message: `нет текста на языке урока ${l}` });
        if (!lesson && has)
          errors.push({ file, field: `${at}.text.${l}`, message: `нет файла ${l}.md — уберите текст ${l}` });
        if (lesson && q.explanation?.ru && !q.explanation[l])
          errors.push({ file, field: `${at}.explanation.${l}`, message: `нет объяснения на языке ${l}` });
        if (q.type === 'single_choice')
          q.options?.forEach((o, n) => {
            if (lesson && !o.text[l])
              errors.push({
                file,
                field: `${at}.options.${n}.text.${l}`,
                message: `нет текста варианта на языке ${l}`,
              });
            if (!lesson && o.text[l])
              errors.push({
                file,
                field: `${at}.options.${n}.text.${l}`,
                message: `нет файла ${l}.md — уберите текст ${l}`,
              });
          });
      }
      topic.questions.push(question);
    });
    if (quiz)
      checkUnique(
        quiz.questions.map((q) => ({ ...q, file })),
        (q) => q.code,
        'questions',
        'код вопроса повторяется',
        errors,
      );
  }
  return topic;
}

const QUESTION_MESSAGES: Record<string, string> = {
  min2: 'нужно хотя бы 2 варианта',
  max8: 'не больше 8 вариантов',
  exactlyOneCorrect: 'ровно один правильный вариант',
  trueFalseTwo: 'у true_false ровно два варианта',
  required: 'обязательное поле',
  tooLong: 'слишком длинный текст',
  atLeastOneLanguage: 'нужен текст хотя бы на одном языке',
};
