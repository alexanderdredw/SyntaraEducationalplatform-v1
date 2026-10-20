import { randomUUID } from 'node:crypto';
import { expect, request, test, type Page } from '@playwright/test';
import { acceptCookies, bundles, expectNoSeriousA11yViolations, hasHorizontalScroll } from './support';

const ru = bundles.ru;
const ts = ru.battle.student;
const uid = () => randomUUID().slice(0, 8);

/** Учитель — отдельный контекст запросов (ведёт игру через API, интерфейс ведущего — этап B4). */
async function teacherApi(baseURL: string) {
  const api = await request.newContext({ baseURL });
  const res = await api.post('/api/auth/register', {
    data: {
      role: 'teacher',
      email: `btl.t.${uid()}@example.kz`,
      displayName: 'Айгерим К.',
      password: 'teacher-pass-1',
    },
  });
  expect(res.status()).toBe(201);
  const csrf = (await api.storageState()).cookies.find((c) => c.name === 'csrf')!.value;
  const post = async (path: string, data: object = {}) => {
    const r = await api.post(path, { data, headers: { 'X-CSRF-Token': csrf } });
    expect(r.ok(), `${path} → ${r.status()} ${await r.text()}`).toBe(true);
    return r.json();
  };
  return { api, post };
}

type Teacher = Awaited<ReturnType<typeof teacherApi>>;

/** Класс, код приглашения, Battle-тест из `count` вопросов (правильный — вариант A) и сессия. */
async function prepareGame(t: Teacher, count = 2) {
  const cls = await t.post('/api/teacher/classes', { name: `7 «${uid()}»` });
  const invite = await t.post(`/api/teacher/classes/${cls.id}/invite-codes`);
  const battle = await t.post('/api/teacher/battles', { title: 'Сердце', locale: 'ru' });
  for (let i = 1; i <= count; i++) {
    await t.post(`/api/teacher/battles/${battle.id}/questions`, {
      type: 'single_choice',
      text: `Вопрос номер ${i}`,
      timeLimitSec: 60,
      options: ['A', 'B', 'C', 'D'].map((l, p) => ({ text: `Вариант ${l}${i}`, isCorrect: p === 0 })),
    });
  }
  const session = await t.post(`/api/teacher/battles/${battle.id}/sessions`, { classId: cls.id });
  return {
    classCode: invite.code as string,
    sessionId: session.sessionId as string,
    code: session.code as string,
  };
}

async function step(t: Teacher, sid: string, action: string) {
  const snap = await (await t.api.get(`/api/teacher/battle-sessions/${sid}`)).json();
  return t.post(`/api/teacher/battle-sessions/${sid}/${action}`, { expectedVersion: snap.version });
}

async function signUpStudent(page: Page, classCode: string, name = 'Асель Каримова') {
  const res = await page.request.post('/api/auth/register-student', {
    data: { displayName: name, login: `btl.s.${uid()}`, password: 'student-pass-1', code: classCode },
  });
  expect(res.status()).toBe(201);
}

/** Итерация 10.5, этап B3: интерфейс ученика (REQ-BTL-S01…S07, AC-BTL-03, AC-BTL-06, AC-BTL-13, AC-BTL-18). */
test.describe('Battle: ученик (B3)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('REQ-BTL-S01..S06 join by code, lobby, answer by tap and keyboard, reveal, top-5, podium, my answers', async ({
    page,
    baseURL,
  }) => {
    const teacher = await teacherApi(baseURL!);
    const game = await prepareGame(teacher);
    await signUpStudent(page, game.classCode);

    // Карточка на главной и пункт «Battle» в боковой панели.
    await page.goto('/ru');
    await expect(page.getByTestId('home-battle')).toContainText(ts.home.title);
    await page.goto('/ru/learn/subjects');
    await page.getByTestId('cabinet-sidebar').getByRole('link', { name: ru.cabinet.nav.battle }).click();
    await expect(page).toHaveURL(/\/ru\/learn\/battles$/);
    await expect(page.getByText(ts.history.empty)).toBeVisible();

    // Неверный код — понятная ошибка; затем код в нижнем регистре (AC-BTL-03).
    const join = page.getByTestId('battle-join');
    await join.getByLabel(ts.join.cell.replace('{n}', '1')).click();
    await page.keyboard.type('zzz999');
    await join.getByRole('button', { name: ts.join.submit }).click();
    await expect(join.getByRole('alert')).toHaveText(ts.errors.codeNotFound);
    await expectNoSeriousA11yViolations(page);
    await join.getByLabel(ts.join.cell.replace('{n}', '1')).click();
    await page.keyboard.type(game.code.toLowerCase());
    await join.getByRole('button', { name: ts.join.submit }).click();
    await expect(page).toHaveURL(new RegExp(`/ru/learn/battles/${game.sessionId}$`));

    // BT-S02 лобби.
    const lobby = page.getByTestId('battle-lobby');
    await expect(lobby.getByRole('heading', { name: ts.lobby.inGame })).toBeVisible();
    await expect(lobby).toContainText(ts.lobby.waiting);
    await expect(lobby).toContainText('Асель К.');
    expect(await hasHorizontalScroll(page)).toBe(false);
    await expectNoSeriousA11yViolations(page);

    // BT-S03: вопрос; нажатие плитки отправляет ответ (AC-BTL-06 — «Ответ принят», без правильности).
    const answerResponse = page.waitForResponse((r) => r.url().includes('/answers'));
    await step(teacher, game.sessionId, 'start');
    const question = page.getByTestId('battle-question');
    await expect(question).toContainText(ts.question.counter.replace('{index}', '1').replace('{total}', '2'));
    await expect(question.getByTestId('battle-tile')).toHaveCount(4);
    await expectNoSeriousA11yViolations(page);
    await question.getByTestId('battle-tile').first().click();
    expect(JSON.stringify(await (await answerResponse).json())).not.toMatch(/isCorrect|correctPosition/);

    // Один участник ответил — раскрытие сразу (BT-S04).
    const reveal = page.getByTestId('battle-reveal');
    await expect(reveal.getByRole('heading', { name: ts.reveal.correct })).toBeVisible();
    await expect(reveal).toContainText(ts.reveal.correctCount.replace('{count}', '1'));
    await expect(reveal).toContainText(ts.reveal.place.replace('{rank}', '1').replace('{total}', '1'));

    // BT-S05: топ-5 и «Ты: 1-е место».
    await step(teacher, game.sessionId, 'next');
    await expect(page.getByTestId('battle-my-place')).toHaveText(ts.leaderboard.me.replace('{rank}', '1'));

    // Вопрос 2 — с клавиатуры: Tab, стрелка, Enter (REQ-BTL-S03, AC-BTL-18).
    await step(teacher, game.sessionId, 'next');
    await expect(question).toContainText(ts.question.counter.replace('{index}', '2').replace('{total}', '2'));
    await question.getByTestId('battle-tile').first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(question.getByTestId('battle-tile').nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(reveal.getByRole('heading', { name: ts.reveal.wrong })).toBeVisible();
    await expect(reveal).toContainText('Вариант A2');

    // BT-S06: итог — пьедестал, своя карточка и строка, «Мои ответы».
    await step(teacher, game.sessionId, 'next');
    const final = page.getByTestId('battle-final');
    await expect(final.getByTestId('battle-podium')).toContainText('Асель К.');
    await expect(final.getByTestId('battle-my-result')).toContainText(
      ts.final.myCorrect.replace('{correct}', '1').replace('{total}', '2'),
    );
    await expect(final.locator('tr[data-me="true"]')).toHaveCount(1);
    expect(await hasHorizontalScroll(page)).toBe(false);
    await expectNoSeriousA11yViolations(page);
    await final.getByRole('link', { name: ts.final.answers }).click();
    await expect(page.getByTestId('battle-my-answer')).toHaveCount(2);
    await expect(page.getByTestId('battle-my-answer').nth(1)).toContainText('Вариант A2');
    await expectNoSeriousA11yViolations(page);

    // История «Мои Battle».
    await page.goto('/ru/learn/battles');
    await expect(page.getByTestId('battle-history-item')).toContainText(
      ts.history.place.replace('{rank}', '1').replace('{total}', '1'),
    );
    await teacher.api.dispose();
  });

  test('REQ-BTL-S07, AC-BTL-10 connection loss: banner after 3 failed reconnects, current phase after reconnect', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(60_000);
    const teacher = await teacherApi(baseURL!);
    const game = await prepareGame(teacher, 1);
    await signUpStudent(page, game.classCode);
    const res = await page.request.post('/api/student/battles/join', {
      data: { code: game.code },
      headers: { 'X-CSRF-Token': (await page.context().cookies()).find((c) => c.name === 'csrf')!.value },
    });
    expect(res.ok()).toBe(true);
    await page.goto(`/ru/learn/battles/${game.sessionId}`);
    await expect(page.getByTestId('battle-lobby')).toBeVisible();
    // Обрыв: поток недоступен; игра идёт без ученика.
    await page.route('**/events', (route) => route.abort());
    await step(teacher, game.sessionId, 'start');
    // Прервать текущий поток: перезагрузка страницы с заблокированным потоком.
    await page.reload();
    await expect(page.getByTestId('battle-connection')).toHaveText(ts.connection, { timeout: 20_000 });
    await page.unroute('**/events');
    await expect(page.getByTestId('battle-question')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('battle-connection')).toHaveCount(0);
    await teacher.api.dispose();
  });

  test('BR-BTL-07 kicked student sees the message and cannot return; another class gets «код не найден»', async ({
    page,
    baseURL,
    browser,
  }) => {
    const teacher = await teacherApi(baseURL!);
    const game = await prepareGame(teacher, 1);
    await signUpStudent(page, game.classCode);
    await page.goto('/ru/learn/battles');
    const join = page.getByTestId('battle-join');
    await join.getByLabel(ts.join.cell.replace('{n}', '1')).click();
    await page.keyboard.type(game.code);
    await join.getByRole('button', { name: ts.join.submit }).click();
    await expect(page.getByTestId('battle-lobby')).toBeVisible();
    const snap = await (await teacher.api.get(`/api/teacher/battle-sessions/${game.sessionId}`)).json();
    await teacher.post(
      `/api/teacher/battle-sessions/${game.sessionId}/participants/${snap.participants[0].id}/kick`,
    );
    await expect(page.getByTestId('battle-message')).toContainText(ts.errors.kicked);
    await page.goto('/ru/learn/battles');
    await join.getByLabel(ts.join.cell.replace('{n}', '1')).click();
    await page.keyboard.type(game.code);
    await join.getByRole('button', { name: ts.join.submit }).click();
    await expect(join.getByRole('alert')).toHaveText(ts.errors.kicked);

    // Ученик другого класса (AC-BTL-04).
    const otherGame = await prepareGame(teacher, 1);
    const ctx = await browser.newContext({ baseURL });
    await acceptCookies(ctx, baseURL);
    const other = await ctx.newPage();
    await signUpStudent(other, otherGame.classCode, 'Чужой Ученик');
    await other.goto('/ru/learn/battles');
    await other.getByTestId('battle-join').getByLabel(ts.join.cell.replace('{n}', '1')).click();
    await other.keyboard.type(game.code);
    await other.getByTestId('battle-join').getByRole('button', { name: ts.join.submit }).click();
    await expect(other.getByTestId('battle-join').getByRole('alert')).toHaveText(ts.errors.codeNotFound);
    await ctx.close();
    await teacher.api.dispose();
  });
});
