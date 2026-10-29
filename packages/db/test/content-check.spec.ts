import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkContent, defaultContentDir, e2eFixturesDir, formatError } from '../src/content';
import { sectionGroup } from '@syntara/shared';

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

  it('REQ-PTBL-02, REQ-PTBL-04 element in ru.md: symbol and family as in the periodic table data; one topic per element', () => {
    const chem = 'natural-sciences/01-chemistry';
    edit(`${chem}/08-oxygen/ru.md`, '  symbol: O\n', '  symbol: Ox\n');
    edit(`${chem}/09-fluorine/ru.md`, '  number: 9\n', '  number: 8\n');
    expect(messages()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/08-oxygen\/ru\.md: element — элемент 8 — O, семейство nonmetal/),
        expect.stringMatching(/ru\.md: element\.number — элемент уже есть в другой теме предмета: 8/),
      ]),
    );
  });

  it('REQ-ATL-01 subject.yaml module: only known modules', () => {
    edit('natural-sciences/01-chemistry/subject.yaml', 'module: atlas-chemistry', 'module: atlas-physics');
    expect(messages()).toEqual([expect.stringMatching(/subject\.yaml: module — модуль: atlas-chemistry/)]);
  });

  it('REQ-ATL-04 element.color: colour #RRGGBB', () => {
    edit('natural-sciences/01-chemistry/08-oxygen/ru.md', "  color: '#EF4444'", "  color: 'red'");
    expect(messages()).toEqual([
      expect.stringMatching(/08-oxygen\/ru\.md: element\.color — цвет вида #RRGGBB/),
    ]);
  });

  it('REQ-TL-01 timeline.yaml: events point to existing sections; birth before death; sorted by year', () => {
    const file = 'natural-sciences/01-chemistry/61-chemists/timeline.yaml';
    const ok = checkContent(dir);
    expect(
      ok.catalog.topics.find((t) => t.code === 'chemistry/chemists')!.timeline!.map((e) => e.year),
    ).toEqual([1774, 1803, 1867, 1869, 1898, 1911, 1913, 1939, 1964]);
    edit(file, 'section: dalton', 'section: avogadro');
    edit(file, 'from: 1743', 'from: 1800');
    expect(messages()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/timeline\.yaml: events\.1\.section — нет раздела \{#avogadro\} в уроке/),
        expect.stringMatching(/timeline\.yaml: events\.0\.lived — год рождения позже года смерти/),
      ]),
    );
  });

  it('REQ-SCI-07 REQ-SCI-08 REQ-SCI-09 REQ-SCI-13 scientists.yaml: facts, elements, sources and prompts of 9 scientists on 3 languages', () => {
    const ok = checkContent(dir);
    const data = ok.catalog.topics.find((t) => t.code === 'chemistry/chemists')!.scientists!;
    expect(data).toHaveLength(9);
    for (const s of data) {
      for (const l of ['ru', 'kk', 'en'] as const) {
        expect(s.translations[l]?.prompts?.biography).toHaveLength(3);
        expect(s.translations[l]?.needsReview).toBe(l !== 'ru');
      }
      expect(s.sources.every((x) => x.url.startsWith('https://'))).toBe(true);
    }
    const by = (code: string) => data.find((s) => s.section === `chemistry/chemists#${code}`)!;
    // В-1: у Лавуазье и Нобеля поля «Награды» нет; В-2: у Ходжкин — только кобальт.
    expect(by('lavoisier').translations.ru!.awards).toBeUndefined();
    expect(by('nobel').translations.ru!.awards).toBeUndefined();
    expect(by('hodgkin').elements).toEqual([{ number: 27, relation: 'structure' }]);
    expect(by('rutherford').elements.map((e) => e.relation)).toEqual([
      'transmuted',
      'transmuted',
      'named_after',
    ]);
  });

  it('REQ-SCI-08 scientists.yaml: the section must exist in the lesson; elements without repeats', () => {
    const file = 'natural-sciences/01-chemistry/61-chemists/scientists.yaml';
    edit(file, 'section: dalton', 'section: avogadro');
    edit(file, '{ number: 21, relation: predicted }', '{ number: 31, relation: predicted }');
    expect(messages()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/scientists.yaml: scientists.1.section — нет раздела {#avogadro} в уроке/),
        expect.stringMatching(/scientists.yaml: scientists.3.elements — элемент повторяется/),
      ]),
    );
  });

  it('REQ-SCI-08 REQ-SCI-09 scientists.yaml: element numbers 1–118, exactly 3 prompts per tab', () => {
    const file = 'natural-sciences/01-chemistry/61-chemists/scientists.yaml';
    edit(file, '{ number: 102, relation: named_after }', '{ number: 119, relation: named_after }');
    edit(file, '          - Как Лавуазье объяснил горение?\n', '');
    expect(messages()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/scientists.yaml: scientists.2.elements.0.number — номер 1–118/),
        expect.stringMatching(/scientists.yaml: scientists.0.prompts.discovery.ru — ровно 3 подсказки/),
      ]),
    );
  });

  it('AC-EXP-06, BR-EXP-01 every section of all 60 element lessons falls into one of the 5 tab groups', () => {
    const elements = checkContent(dir).catalog.topics.filter((t) => t.elementNumber);
    expect(elements).toHaveLength(60);
    for (const t of elements)
      for (const s of t.sections) {
        if (s.code.endsWith('#sources')) continue;
        expect(sectionGroup(s.code, s.translations.ru!.title), `${t.code}: ${s.code}`).not.toBeNull();
      }
  });

  it('REQ-EXP-05.3 bohr-default.yaml: 11 elements show the Bohr model while their picture is the same', () => {
    const flagged = () =>
      checkContent(dir)
        .catalog.topics.filter((t) => t.bohrDefault)
        .map((t) => t.code.split('/')[1]);
    expect(flagged()).toEqual([
      'lithium',
      'carbon',
      'nitrogen',
      'oxygen',
      'sodium',
      'potassium',
      'calcium',
      'scandium',
      'manganese',
      'gallium',
      'xenon',
    ]);
    // Новая картинка (другой хеш) — элемент уходит из списка; неизвестный урок — ошибка.
    const file = 'natural-sciences/01-chemistry/bohr-default.yaml';
    edit(file, '{ topic: lithium, image: 8', '{ topic: lithium, image: 9');
    expect(flagged()).not.toContain('lithium');
    edit(file, 'topic: xenon', 'topic: unobtainium');
    expect(messages()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/bohr-default\.yaml: elements\.10\.topic — нет урока-элемента с иллюстрацией/),
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

  it('BR-CNT-03 the e2e test subject is valid together with content/: chapters, glossary, periodic table, timeline', () => {
    const { catalog, errors } = checkContent(defaultContentDir(), [e2eFixturesDir()]);
    expect(errors.map(formatError)).toEqual([]);
    const subject = catalog.subjects.find((s) => s.code === 'e2e-fixture')!;
    expect(subject.chapters.map((c) => c.code)).toEqual(['elements', 'scientists']);
    expect(subject.blocks).toEqual(['periodic-table']);
    expect(subject.glossary?.sections).toHaveLength(2);
    const topics = catalog.topics.filter((t) => t.subjectCode === 'e2e-fixture');
    expect(topics.map((t) => t.elementNumber ?? null)).toEqual([1, 3, 8, null]);
    expect(topics[3]!.timeline).toHaveLength(3);
    // Основная папка не меняется: базовые предметы на месте (импорт не отправит их в архив).
    expect(catalog.subjects.filter((s) => s.code !== 'e2e-fixture')).toHaveLength(
      checkContent().catalog.subjects.length,
    );
  });

  it('BR-CNT-03 an extra folder may not repeat codes or section positions of content/', () => {
    const codes = checkContent(defaultContentDir(), [dir]).errors.map((e) => e.message);
    expect(codes).toEqual(
      expect.arrayContaining([
        'код или порядковый номер раздела уже есть в content/',
        'код предмета уже есть в content/',
        'код темы уже есть в content/',
      ]),
    );
  });
});
