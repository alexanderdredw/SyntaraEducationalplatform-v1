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
    expect(catalog.topics.map((t) => t.code)).toEqual([
      'human-anatomy/cardiovascular-system',
      'human-anatomy/respiratory-system',
      'human-anatomy/digestive-system',
    ]);
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
