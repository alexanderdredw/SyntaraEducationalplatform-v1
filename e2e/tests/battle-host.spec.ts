import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { acceptCookies, bundles, expectNoSeriousA11yViolations, hasHorizontalScroll } from './support';

const ru = bundles.ru;
const th = ru.battle.host;
const ts = ru.battle.student;
const uid = () => randomUUID().slice(0, 8);

const csrf = async (page: Page) => (await page.context().cookies()).find((c) => c.name === 'csrf')!.value;
async function apiPost(page: Page, path: string, data: object = {}) {
  const res = await page.request.post(path, { data, headers: { 'X-CSRF-Token': await csrf(page) } });
  expect(res.ok(), `${path} → ${res.status()} ${await res.text()}`).toBe(true);
  return res.json();
}

async function newPage(browser: Browser, baseURL: string) {
  const ctx = await browser.newContext({ baseURL });
  await acceptCookies(ctx, baseURL);
  return ctx.newPage();
}

/** Учитель с классом, кодом приглашения и тестом из 2 вопросов (правильный — A). */
async function teacherWithBattle(page: Page) {
  const reg = await page.request.post('/api/auth/register', {
    data: {
      role: 'teacher',
      email: `btl.h.${uid()}@example.kz`,
      displayName: 'Айгерим К.',
      password: 'teacher-pass-1',
    },
  });
  expect(reg.status()).toBe(201);
  const cls = await apiPost(page, '/api/teacher/classes', { name: `8 «${uid()}»` });
  const invite = await apiPost(page, `/api/teacher/classes/${cls.id}/invite-codes`);
  const battle = await apiPost(page, '/api/teacher/battles', { title: 'Сердце и сосуды', locale: 'ru' });
  for (let i = 1; i <= 2; i++) {
    await apiPost(page, `/api/teacher/battles/${battle.id}/questions`, {
      type: 'single_choice',
      text: `Вопрос номер ${i}`,
      timeLimitSec: 60,
      options: ['A', 'B', 'C', 'D'].map((l, p) => ({ text: `Вариант ${l}${i}`, isCorrect: p === 0 })),
    });
  }
  return { className: cls.name as string, classCode: invite.code as string, battleId: battle.id as string };
}

/** Итерация 10.5, этап B4: экран ведущего (REQ-BTL-T03…T08, T10; AC-BTL-03, AC-BTL-05, AC-BTL-07, AC-BTL-13, AC-BTL-15). */
test.describe('Battle: ведущий (B4)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('REQ-BTL-T03..T08 teacher + 3 students in separate browsers play to the podium; kick; projector mode', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const setup = await teacherWithBattle(page);
    const students: Page[] = [];
    const names = ['Асель Каримова', 'Ержан Сейтов', 'Дана Ахметова', 'Лишний Ученик'];
    for (const name of names) {
      const s = await newPage(browser, baseURL!);
      const res = await s.request.post('/api/auth/register-student', {
        data: { displayName: name, login: `btl.${uid()}`, password: 'student-pass-1', code: setup.classCode },
      });
      expect(res.status()).toBe(201);
      students.push(s);
    }

    // BT-T03: «Запустить» → класс и настройки → «Создать игру» → лобби.
    await page.goto('/ru/teacher/battles');
    await page
      .getByTestId('battle-card')
      .getByRole('button', { name: ru.battle.teacher.list.launch })
      .click();
    const launch = page.getByTestId('battle-launch');
    await launch.getByRole('combobox', { name: th.launch.class }).click();
    await page.getByRole('option', { name: new RegExp(setup.className) }).click();
    await expect(launch.getByRole('checkbox', { name: th.launch.leaderboard })).toBeChecked();
    await launch.getByRole('button', { name: th.launch.submit }).click();
    await expect(page).toHaveURL(/\/ru\/teacher\/battle-sessions\/[0-9a-f-]+$/);
    const lobby = page.getByTestId('host-lobby');
    const code = (await lobby.getByTestId('battle-code').textContent())!.trim();
    expect(code).toMatch(/^[A-Z]{3}[1-9]{3}$/);
    await expect(lobby).toContainText(th.lobby.hint);
    await expect(page.getByRole('button', { name: th.lobby.start })).toBeDisabled();
    await expectNoSeriousA11yViolations(page);

    // Ученики входят по коду — ведущий видит их без перезагрузки (AC-BTL-03).
    for (const s of students) {
      await s.goto('/ru/learn/battles');
      await s.getByTestId('battle-join').getByLabel(ts.join.cell.replace('{n}', '1')).click();
      await s.keyboard.type(code.toLowerCase());
      await s.getByTestId('battle-join').getByRole('button', { name: ts.join.submit }).click();
      await expect(s.getByTestId('battle-lobby')).toBeVisible();
    }
    await expect(page.getByTestId('host-count')).toHaveText(th.lobby.count.replace('{count}', '4'));

    // Выгон (AC-BTL-15): подтверждение; у ученика — сообщение.
    await page.getByRole('button', { name: th.lobby.kick.replace('{name}', 'Лишний У.') }).click();
    await page.getByRole('dialog').getByRole('button', { name: th.kick.confirm }).click();
    await expect(page.getByTestId('host-count')).toHaveText(th.lobby.count.replace('{count}', '3'));
    await expect(students[3]!.getByTestId('battle-message')).toContainText(ts.errors.kicked);

    // Режим проектора: крупно, без боковой панели, выход по Esc.
    await page.getByRole('button', { name: th.projector }).click();
    await expect(page.getByTestId('host-game')).toHaveAttribute('data-projector', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('host-game')).not.toHaveAttribute('data-projector', 'true');

    // BT-T05: «Начать» — вопрос у всех одновременно (AC-BTL-05).
    await page.getByRole('button', { name: th.lobby.start }).click();
    const counter = th.question.counter.replace('{index}', '1').replace('{total}', '2');
    await expect(page.getByTestId('host-question')).toContainText(counter);
    for (const s of students.slice(0, 3))
      await expect(s.getByTestId('battle-question')).toContainText(counter);
    await expect(page.getByTestId('host-answered')).toHaveText(
      th.question.answered.replace('{answered}', '0').replace('{total}', '3'),
    );
    await expectNoSeriousA11yViolations(page);

    // Ответы: двое правильно, один неверно; все ответили — раскрытие досрочно (AC-BTL-07).
    await students[0]!.getByTestId('battle-tile').first().click();
    await expect(page.getByTestId('host-answered')).toHaveText(
      th.question.answered.replace('{answered}', '1').replace('{total}', '3'),
    );
    await students[1]!.getByTestId('battle-tile').first().click();
    await students[2]!.getByTestId('battle-tile').nth(2).click();
    const reveal = page.getByTestId('host-reveal');
    await expect(reveal).toBeVisible();
    await expect(reveal.getByTestId('host-distribution').getByRole('listitem').first()).toHaveAccessibleName(
      th.reveal.bar.replace('{letter}', 'A').replace('{count}', '2'),
    );
    await expect(reveal.getByTestId('host-reveal-tile').first()).toHaveAttribute('data-state', 'correct');
    await expect(students[2]!.getByTestId('battle-reveal')).toHaveAttribute('data-correct', 'false');
    await expectNoSeriousA11yViolations(page);

    // BT-T07: топ-5 → «Следующий вопрос».
    await page.getByRole('button', { name: th.reveal.next }).click();
    await expect(page.getByTestId('host-board').getByTestId('battle-leaderboard')).toContainText('Асель К.');
    await page.getByRole('button', { name: th.leaderboard.next }).click();
    await expect(page.getByTestId('host-question')).toContainText(
      th.question.counter.replace('{index}', '2').replace('{total}', '2'),
    );
    // Ведущий закрывает вопрос досрочно (не все ответили).
    await students[0]!.getByTestId('battle-tile').first().click();
    await page.getByRole('button', { name: th.question.close }).click();
    await expect(page.getByTestId('host-reveal')).toBeVisible();
    await expect(students[1]!.getByTestId('battle-reveal')).toHaveAttribute('data-correct', 'false');

    // BT-T08: последний вопрос → итог с пьедесталом (AC-BTL-13).
    await page.getByRole('button', { name: th.reveal.next }).click();
    const final = page.getByTestId('host-final');
    await expect(final.getByTestId('battle-podium')).toContainText('Асель К.');
    await expect(final.getByRole('link', { name: th.final.details })).toBeVisible();
    await expect(final.getByRole('link', { name: th.final.csv })).toHaveAttribute('href', /results\.csv$/);
    await expect(students[0]!.getByTestId('battle-my-result')).toContainText(
      ts.final.myPlace.replace('{rank}', '1').replace('{total}', '3'),
    );
    expect(await hasHorizontalScroll(page)).toBe(false);
    await expectNoSeriousA11yViolations(page);

    // «Сыграть ещё раз» — новая сессия того же теста и класса.
    const before = page.url();
    await final.getByRole('button', { name: th.final.again }).click();
    await expect(page).not.toHaveURL(before);
    await expect(page.getByTestId('host-lobby')).toBeVisible();
    for (const s of students) await s.context().close();
  });
});
