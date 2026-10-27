import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkContent, defaultContentDir, formatError } from '../src/content';

const CARDIO = 'biology/01-human-anatomy/01-cardiovascular-system';

/** Проверка файлов content/ без БД (BR-CNT-02, BR-CNT-03, BR-CNT-05, BR-CNT-06) — то же, что `pnpm content:check`. */
describe('content check', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'syntara-check-'));
    cpSync(defaultContentDir(), dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const write = (file: string, text: string) => writeFileSync(join(dir, file), text);
  const edit = (file: string, from: string, to: string) => {
    const text = readFileSync(join(dir, file), 'utf8');
    expect(text).toContain(from);
    write(file, text.replace(from, to));
  };
  const messages = () => checkContent(dir).errors.map(formatError);

  it('BR-CNT-03 the content/ of the repository is valid', () => {
    const { catalog, errors } = checkContent();
    expect(errors.map(formatError)).toEqual([]);
    expect(catalog.topics.filter((t) => t.subjectCode === 'human-anatomy').map((t) => t.code)).toEqual([
      'human-anatomy/cardiovascular-system',
      'human-anatomy/respiratory-system',
      'human-anatomy/digestive-system',
    ]);
    // AC-CHEM-02: «Химия» — 2 главы, 60 элементов по атомному номеру и «Учёные-химики» (сквозная «Тема N»).
    const chemistry = catalog.topics
      .filter((t) => t.subjectCode === 'chemistry')
      .sort((a, b) => a.position - b.position);
    expect(catalog.subjects.find((s) => s.code === 'chemistry')!.chapters.map((c) => c.code)).toEqual([
      'elements',
      'scientists',
    ]);
    expect(chemistry).toHaveLength(61);
    expect(chemistry.slice(0, 3).map((t) => t.code)).toEqual([
      'chemistry/hydrogen',
      'chemistry/helium',
      'chemistry/lithium',
    ]);
    expect(chemistry.map((t) => t.chapterCode).filter((c) => c === 'elements')).toHaveLength(60);
    expect(chemistry.at(-1)).toMatchObject({
      code: 'chemistry/chemists',
      chapterCode: 'scientists',
      position: 61,
    });
  });

  it('BR-CNT-05 ru.md is required; kk/en need review: needs_review or reviewed', () => {
    rmSync(join(dir, CARDIO, 'ru.md'));
    edit('biology/01-human-anatomy/02-respiratory-system/kk.md', 'review: needs_review\n', '');
    expect(messages()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/01-cardiovascular-system — нет ru\.md/),
        expect.stringMatching(/02-respiratory-system\/kk\.md: review — /),
      ]),
    );
  });

  it('BR-CNT-06 images: only WEBP/PNG/JPG, signature matches, at most 300 KB, source and licence declared, all used', () => {
    write(`${CARDIO}/media/heart.png`, 'not a png');
    write(`${CARDIO}/media/big.png`, 'x');
    write(`${CARDIO}/media/scheme.svg`, '<svg/>');
    edit(
      `${CARDIO}/ru.md`,
      '![Схема трёх видов сосудов',
      '![Схема](media/scheme.svg)\n\n![Схема трёх видов сосудов',
    );
    expect(messages()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/media\/heart\.png — содержимое файла не совпадает с расширением/),
        expect.stringMatching(/media\/big\.png — картинка не используется в уроке/),
        expect.stringMatching(/в разделе больше одной картинки/),
      ]),
    );
  });

  it('BR-CNT-06 every image declares its source and a licence: own, CC0 or public-domain', () => {
    edit(
      `${CARDIO}/ru.md`,
      'license: own\n  - file: media/vessels.png',
      'license: copyrighted\n  - file: media/vessels.png',
    );
    expect(messages()).toEqual([
      expect.stringMatching(/ru\.md: media\.1\.license — лицензия: own, CC0, public-domain/),
    ]);
  });

  it('BR-CNT-06 an image over 300 KB is rejected', () => {
    const png = readFileSync(join(dir, CARDIO, 'media/heart.png'));
    writeFileSync(join(dir, CARDIO, 'media/heart.png'), Buffer.concat([png, Buffer.alloc(300 * 1024)]));
    expect(messages()).toEqual(expect.arrayContaining([expect.stringMatching(/heart\.png — больше 300 КБ/)]));
  });

  it('BR-CNT-02 accordion sections need a code; images only inside sections, with a caption', () => {
    edit(`${CARDIO}/ru.md`, '## Основные функции {#functions}', '## Основные функции');
    edit(
      `${CARDIO}/ru.md`,
      '![Схема трёх видов сосудов',
      '![](media/vessels.png)\n\n![Схема трёх видов сосудов',
    );
    expect(messages()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/ru\.md: строка \d+ после заголовка — у раздела нет кода/),
        expect.stringMatching(/у картинки нет подписи/),
      ]),
    );
  });

  it('BR-QZ-02, BR-CNT-05 quiz: exactly one correct option; every lesson language has its texts', () => {
    edit(
      `${CARDIO}/quiz.yaml`,
      '      - text: { ru: Полая вена, kk: Қуыс вена, en: Vena cava }',
      '      - text: { ru: Полая вена, kk: Қуыс вена, en: Vena cava }\n        correct: true',
    );
    edit(`${CARDIO}/quiz.yaml`, '      kk: Адам жүрегінде неше камера бар? Санды жаз.\n', '');
    expect(messages()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/quiz\.yaml: questions\.0 \(aorta\)\.options — ровно один правильный вариант/),
        expect.stringMatching(
          /quiz\.yaml: questions\.1 \(chambers\)\.text\.kk — нет текста на языке урока kk/,
        ),
      ]),
    );
  });

  it('BR-CNT-04 topic codes and positions are unique inside a subject', () => {
    edit('biology/01-human-anatomy/02-respiratory-system/ru.md', 'position: 2', 'position: 1');
    expect(messages()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/position — порядковый номер темы в предмете повторяется/),
      ]),
    );
  });

  it('REQ-GLOS-01 glossary.yaml: term codes unique in the subject; every language has both the term and the definition', () => {
    const file = 'natural-sciences/01-chemistry/glossary.yaml';
    edit(file, '      - code: molecule\n', '      - code: atom\n');
    edit(file, '          kk: Молекула\n', '');
    expect(messages()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/glossary\.yaml: terms — код термина повторяется: atom/),
        expect.stringMatching(
          /glossary\.yaml: sections\.0\.terms\.1 \(atom\) — на языке kk нужны и термин, и определение/,
        ),
      ]),
    );
  });

  describe('chapters (BR-CHAP-01, BR-CHAP-02)', () => {
    const ANATOMY = 'biology/01-human-anatomy';
    const CHAPTERS = `chapters:
  - code: circulation
    position: 2
    title: { ru: 'Кровь и дыхание', kk: 'Қан және тыныс', en: 'Blood and breathing' }
  - code: food
    position: 1
    title: { ru: 'Питание' }
`;
    const addChapters = () => {
      write(`${ANATOMY}/subject.yaml`, readFileSync(join(dir, ANATOMY, 'subject.yaml'), 'utf8') + CHAPTERS);
      edit(
        `${ANATOMY}/01-cardiovascular-system/ru.md`,
        'position: 1\n',
        'position: 1\nchapter: circulation\n',
      );
      edit(`${ANATOMY}/02-respiratory-system/ru.md`, 'position: 2\n', 'position: 2\nchapter: circulation\n');
      edit(`${ANATOMY}/03-digestive-system/ru.md`, 'position: 3\n', 'position: 1\nchapter: food\n');
    };

    it('BR-CHAP-02 «Тема N» runs through the subject by chapters; position is the order inside a chapter', () => {
      addChapters();
      const { catalog, errors } = checkContent(dir);
      expect(errors.map(formatError)).toEqual([]);
      const anatomy = catalog.subjects.find((s) => s.code === 'human-anatomy')!;
      expect(anatomy.chapters.map((c) => c.code)).toEqual(['food', 'circulation']);
      expect(anatomy.chapters[1]!.translations).toEqual({
        ru: { title: 'Кровь и дыхание', needsReview: false },
        kk: { title: 'Қан және тыныс', needsReview: true },
        en: { title: 'Blood and breathing', needsReview: true },
      });
      const order = catalog.topics
        .filter((t) => t.subjectCode === 'human-anatomy')
        .sort((a, b) => a.position - b.position)
        .map((t) => [t.position, t.chapterCode, t.code]);
      expect(order).toEqual([
        [1, 'food', 'human-anatomy/digestive-system'],
        [2, 'circulation', 'human-anatomy/cardiovascular-system'],
        [3, 'circulation', 'human-anatomy/respiratory-system'],
      ]);
    });

    it('BR-CHAP-02 with chapters every topic needs a known chapter; positions are unique inside a chapter', () => {
      addChapters();
      edit(`${ANATOMY}/01-cardiovascular-system/ru.md`, 'chapter: circulation\n', '');
      edit(`${ANATOMY}/02-respiratory-system/ru.md`, 'chapter: circulation', 'chapter: lungs');
      edit(
        `${ANATOMY}/subject.yaml`,
        "position: 1\n    title: { ru: 'Питание' }",
        "position: 2\n    title: { ru: 'Питание' }",
      );
      expect(messages()).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /01-cardiovascular-system\/ru\.md: chapter — у предмета есть главы — укажите chapter/,
          ),
          expect.stringMatching(/02-respiratory-system\/ru\.md: chapter — нет главы lungs в subject\.yaml/),
          expect.stringMatching(/subject\.yaml: chapters — порядковый номер главы повторяется/),
        ]),
      );
    });

    it('BR-CHAP-02 without chapters a topic must not name one; a subject without chapters is unchanged', () => {
      edit(
        `${ANATOMY}/01-cardiovascular-system/ru.md`,
        'position: 1\n',
        'position: 1\nchapter: circulation\n',
      );
      expect(messages()).toEqual([
        expect.stringMatching(/01-cardiovascular-system\/ru\.md: chapter — у предмета нет глав/),
      ]);
      const { catalog } = checkContent();
      expect(catalog.subjects.find((s) => s.code === 'human-anatomy')!.chapters).toEqual([]);
    });
  });

  it('BR-CNT-02 subjects need a position, unique inside a section; every folder is a section (no _root)', () => {
    edit('natural-sciences/02-physics/subject.yaml', 'position: 2', 'position: 1');
    edit('natural-sciences/03-geography/subject.yaml', 'position: 3\n', '');
    cpSync(join(dir, 'natural-sciences/01-chemistry'), join(dir, '_root/01-chemistry'), { recursive: true });
    expect(messages()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /02-physics\/subject\.yaml: position — порядковый номер предмета в разделе повторяется/,
        ),
        expect.stringMatching(/03-geography\/subject\.yaml: position — /),
        expect.stringMatching(/_root — нет section\.yaml/),
      ]),
    );
  });

  it('BR-FILE-09 content:check rejects spreadsheet files: by extension and an Excel workbook under another name', () => {
    write(`${CARDIO}/media/data.xlsx`, 'x');
    write(`${CARDIO}/grades.csv`, 'a;b\n1;2\n');
    write(`${CARDIO}/media/table.ods`, 'x');
    // Книга Excel 97 (CFB с потоком Workbook) под видом картинки.
    const workbook = Buffer.alloc(1024);
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(workbook);
    Buffer.from('Workbook', 'utf16le').copy(workbook, 640);
    workbook[640 + 64] = 18;
    workbook[640 + 66] = 2;
    writeFileSync(join(dir, CARDIO, 'media', 'scheme.png'), workbook);
    const spreadsheet = (file: string) =>
      expect.stringContaining(`${CARDIO}/${file} — табличный файл запрещён (BR-FILE-09)`);
    expect(messages()).toEqual(
      expect.arrayContaining([
        spreadsheet('media/data.xlsx'),
        spreadsheet('grades.csv'),
        spreadsheet('media/table.ods'),
        spreadsheet('media/scheme.png'),
      ]),
    );
  });
});
