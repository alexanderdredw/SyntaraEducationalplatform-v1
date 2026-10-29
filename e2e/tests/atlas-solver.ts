import { expect, type Page } from '@playwright/test';
import { electronConfig, PERIODIC_ELEMENTS } from '@syntara/shared';
import { bundles } from './support';

const Q = bundles.ru.atlas.quiz.q;
const GROUPS = bundles.ru.atlas.group as Record<string, string>;

export interface QuizElement {
  topicId: string;
  title: string;
  symbol: string;
  number: number;
  group: string;
  description: string | null;
  funFact: string | null;
}

/** Шаблон i18n «… {x} …» → регулярное выражение с группами на месте параметров. */
function template(text: string): RegExp {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^${text
      .split(/\{\w+\}/)
      .map(escape)
      .join('(.+?)')}$`,
  );
}
const match = (key: string, text: string) => template(key).exec(text.trim());

/** Загадка с «___»: элемент, в описании или факте которого совпадает текст. */
function riddle(text: string, options: string[], elements: QuizElement[]) {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(text.split('___').map(escape).join('.+?'), 'i');
  return options.find((title) => {
    const e = elements.find((x) => x.title === title);
    return e && [e.description, e.funFact].some((s) => s && pattern.test(s));
  });
}

export type Solution =
  { kind: 'option'; text: string } | { kind: 'cell'; symbol: string } | { kind: 'input'; text: string };

/**
 * Правильный ответ на текущий вопрос квиза атласа (REQ-TST-10) по тому, что видно на экране, и данным таблицы —
 * как решал бы ученик: символ, название, утверждение, схема Бора, конфигурация, таблица, загадка.
 */
export async function solveAtlas(page: Page, elements: QuizElement[]): Promise<Solution> {
  const text = ((await page.getByTestId('atest-question').textContent()) ?? '').trim();
  const options = (await page.locator('[data-testid="atest-option"] .atest-opt-text').allTextContents()).map(
    (s) => s.trim(),
  );
  const by = (f: (e: QuizElement) => boolean) => elements.find(f)!;
  const periodic = (e: QuizElement) => PERIODIC_ELEMENTS[e.number - 1]!;

  if (
    await page
      .getByTestId('atest-table')
      .isVisible()
      .catch(() => false)
  ) {
    const name = match(Q.tableName, text);
    if (name) return { kind: 'cell', symbol: by((e) => e.title === name[1]).symbol };
    const cell = match(Q.tableCell, text)!;
    const [period, group] = [Number(cell[1]), Number(cell[2])];
    return {
      kind: 'cell',
      symbol: by((e) => periodic(e).period === period && periodic(e).group === group).symbol,
    };
  }
  const typed = match(Q.typeSymbol, text);
  if (typed) return { kind: 'input', text: by((e) => e.title === typed[1]).symbol };

  if (
    await page
      .getByTestId('atest-bohr')
      .isVisible()
      .catch(() => false)
  ) {
    const label = (await page.getByTestId('atest-bohr').getAttribute('aria-label')) ?? '';
    const shells = /—\s*([\d,\s]+)$/.exec(label)![1]!.split(',').map(Number);
    const total = shells.reduce((a, b) => a + b, 0);
    if (text === Q.bohrCount) return { kind: 'option', text: String(total) };
    return { kind: 'option', text: by((e) => e.number === total).title };
  }
  if (options.length === 2 && options.includes(Q.true)) {
    const truth = (ok: boolean) => ({ kind: 'option' as const, text: ok ? Q.true : Q.false });
    const family = match(Q.factFamily, text);
    if (family) return truth(GROUPS[by((e) => e.title === family[1]).group] === family[2]);
    const period = match(Q.factPeriod, text);
    if (period) return truth(periodic(by((e) => e.title === period[1])).period === Number(period[2]));
    const group = match(Q.factGroup, text);
    if (group) return truth(periodic(by((e) => e.title === group[1])).group === Number(group[2]));
    const number = match(Q.factNumber, text)!;
    return truth(by((e) => e.title === number[1]).number > by((e) => e.title === number[2]).number);
  }
  const symbol = match(Q.symbolToName, text);
  if (symbol) return { kind: 'option', text: by((e) => e.symbol === symbol[1]).title };
  const name = match(Q.nameToSymbol, text);
  if (name) return { kind: 'option', text: by((e) => e.title === name[1]).symbol };
  const config = match(Q.config, text);
  if (config) return { kind: 'option', text: by((e) => electronConfig(e.number) === config[1]).title };
  const right = riddle(text, options, elements);
  expect(right, text).toBeTruthy();
  return { kind: 'option', text: right! };
}

/** Ответить решением; `wrong` — заведомо неверно (другой вариант, другая ячейка, другой символ). */
export async function answerAtlas(page: Page, elements: QuizElement[], wrong = false): Promise<void> {
  const s = await solveAtlas(page, elements);
  if (s.kind === 'input') {
    await page.locator('.atest-input').fill(wrong ? `${s.text}x` : s.text);
    await page.locator('.atest-input-row button[type="submit"]').click();
    return;
  }
  if (s.kind === 'cell') {
    const target = wrong
      ? page.locator(`[data-testid="atest-cell"]:not([data-symbol="${s.symbol}"])`).first()
      : page.locator(`[data-testid="atest-cell"][data-symbol="${s.symbol}"]`);
    await target.click();
    await page.getByTestId('atest-submit').click();
    return;
  }
  const option = (text: string) =>
    page
      .locator('[data-testid="atest-option"]:not([aria-disabled])')
      .filter({ has: page.locator('.atest-opt-text').getByText(text, { exact: true }) });
  if (!wrong) return option(s.text).click();
  await page
    .locator('[data-testid="atest-option"]:not([aria-disabled])')
    .filter({ hasNot: page.locator('.atest-opt-text').getByText(s.text, { exact: true }) })
    .first()
    .click();
}

/** Любой ответ (первый вариант, первая ячейка, символ «X») — для прохождения без проверки правильности. */
export async function answerAny(page: Page): Promise<void> {
  if (
    await page
      .getByTestId('atest-table')
      .isVisible()
      .catch(() => false)
  ) {
    await page.locator('[data-testid="atest-cell"]').first().click();
    await page.getByTestId('atest-submit').click();
  } else if (
    await page
      .locator('.atest-input')
      .isVisible()
      .catch(() => false)
  ) {
    await page.locator('.atest-input').fill('X');
    await page.locator('.atest-input-row button[type="submit"]').click();
  } else await page.locator('[data-testid="atest-option"]:not([aria-disabled])').first().click();
}
