import { elementQuizText, maskElementText, maskLeaks, periodicElement } from '@syntara/shared';
import { checkContent } from '../src/content';

const LOCALES = ['ru', 'kk', 'en'] as const;

/**
 * AC-TST-08, REQ-TST-08, BR-TST-03 (docs/TESTS_TZ.md): маскировка вопросов квиза «Проверь знания» на исправленном
 * содержании content/ — 60 элементов × 3 уровня × 3 языка. Текст вопроса не содержит основы названия (≥ 4 букв),
 * названия и символа отдельным словом; где замаскировать надёжно нельзя — другой источник текста или пропуск.
 */
describe('atlas quiz masking on content/ (AC-TST-08)', () => {
  const { catalog, errors } = checkContent();
  const elements = catalog.topics.filter((t) => t.subjectCode === 'chemistry' && t.elementNumber);

  it('AC-TST-08 60 elements × 3 levels × 3 languages: no leaks of the name, its stem or the symbol', () => {
    expect(errors).toEqual([]);
    expect(elements).toHaveLength(60);
    const leaks: string[] = [];
    const skipped: string[] = [];
    for (const e of elements) {
      const symbol = periodicElement(e.elementNumber!)!.symbol;
      for (const locale of LOCALES) {
        const tr = e.translations[locale];
        expect(tr?.title, `${e.code} ${locale}`).toBeTruthy();
        for (const level of [1, 2, 3]) {
          const text = elementQuizText(level, tr!, symbol, locale);
          if (text === null) {
            skipped.push(`${e.code} ${locale} ${level}`);
            continue;
          }
          const found = maskLeaks(text, tr!.title, symbol, locale);
          if (found.length) leaks.push(`${e.code} ${locale} L${level}: ${found.join(', ')} — ${text}`);
        }
      }
    }
    expect(leaks).toEqual([]);
    // Пропусков нет: у каждого элемента на каждом уровне и языке есть замаскированный текст.
    expect(skipped).toEqual([]);
  });

  it('REQ-TST-08.1 forms of the name are hidden in the real texts (e.g. «кислорода», «кислородный»)', () => {
    const forms: string[] = [];
    for (const e of elements) {
      const symbol = periodicElement(e.elementNumber!)!.symbol;
      for (const locale of LOCALES) {
        const tr = e.translations[locale]!;
        for (const source of [tr.description, tr.funFact]) {
          if (!source) continue;
          // Прежняя маскировка (только точная форма названия) оставляла бы утечку — новая её закрывает.
          const exactOnly = source.replace(new RegExp(`(^|\\P{L})${tr.title}(?=\\P{L}|$)`, 'giu'), '$1___');
          if (maskLeaks(exactOnly, tr.title, symbol, locale).length) forms.push(`${e.code} ${locale}`);
          expect(
            maskLeaks(maskElementText(source, tr.title, symbol, locale), tr.title, symbol, locale),
          ).toEqual([]);
        }
      }
    }
    // В исправленном содержании есть тексты с формами названия — маскировка их закрывает.
    expect(forms.length).toBeGreaterThan(0);
  });
});
