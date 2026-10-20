import { randomUUID } from 'node:crypto';
import { type APIRequestContext, expect, request, test, type Page } from '@playwright/test';
import { acceptCookies, bundles, expectNoSeriousA11yViolations, hasHorizontalScroll } from './support';

const ru = bundles.ru;
const tr = ru.battle.teacher.results;
const th = ru.battle.teacher.history;
const uid = () => randomUUID().slice(0, 8);

const csrf = async (page: Page) => (await page.context().cookies()).find((c) => c.name === 'csrf')!.value;
async function post(page: Page, path: string, data: object = {}) {
  const res = await page.request.post(path, { data, headers: { 'X-CSRF-Token': await csrf(page) } });
  expect(res.ok(), `${path} → ${res.status()} ${await res.text()}`).toBe(true);
  return res.json();
}

/** Игра через API: 2 ученика, 2 вопроса; Асель — оба верно, Ержан — первый неверно. */
async function playedGame(page: Page, baseURL: string) {
  const reg = await page.request.post('/api/auth/register', {
    data: {
      role: 'teacher',
      email: `btl.r.${uid()}@example.kz`,
      displayName: 'Учитель',
      password: 'teacher-pass-1',
    },
  });
  expect(reg.status()).toBe(201);
  const cls = await post(page, '/api/teacher/classes', { name: `9 «${uid()}»` });
  const invite = await post(page, `/api/teacher/classes/${cls.id}/invite-codes`);
  const battle = await post(page, '/api/teacher/battles', { title: 'Кровообращение', locale: 'ru' });
  for (let i = 1; i <= 2; i++) {
    await post(page, `/api/teacher/battles/${battle.id}/questions`, {
      type: 'single_choice',
      text: `Вопрос номер ${i}`,
      timeLimitSec: 60,
      options: ['A', 'B'].map((l, p) => ({ text: `Вариант ${l}${i}`, isCorrect: p === 0 })),
    });
  }
  const { sessionId, code } = await post(page, `/api/teacher/battles/${battle.id}/sessions`, {
    classId: cls.id,
  });
  const students: Array<{ api: APIRequestContext; token: string }> = [];
  for (const name of ['Асель Каримова', 'Ержан Сейтов']) {
    const api = await request.newContext({ baseURL });
    await api.post('/api/auth/register-student', {
      data: { displayName: name, login: `btl.r.${uid()}`, password: 'student-pass-1', code: invite.code },
    });
    const token = (await api.storageState()).cookies.find((c) => c.name === 'csrf')!.value;
    await api.post('/api/student/battles/join', { data: { code }, headers: { 'X-CSRF-Token': token } });
    students.push({ api, token });
  }
  const step = async (action: string) => {
    const snap = await (await page.request.get(`/api/teacher/battle-sessions/${sessionId}`)).json();
    return post(page, `/api/teacher/battle-sessions/${sessionId}/${action}`, {
      expectedVersion: snap.version,
    });
  };
  const answer = (i: number, q: number, option: number) =>
    students[i]!.api.post(`/api/student/battle-sessions/${sessionId}/answers`, {
      data: { questionIndex: q, optionPosition: option, clientAnswerId: randomUUID() },
      headers: { 'X-CSRF-Token': students[i]!.token },
    });
  await step('start');
  await answer(0, 0, 1);
  await answer(1, 0, 2);
  await step('next'); // reveal → leaderboard
  await step('next'); // → вопрос 2
  await answer(0, 1, 1);
  await answer(1, 1, 1);
  await step('next'); // последний: reveal → finished
  for (const s of students) await s.api.dispose();
  return { sessionId, classId: cls.id as string };
}

/** Итерация 10.5, этап B5: история и результаты (REQ-BTL-T01, REQ-BTL-T09, REQ-BTL-T11; AC-BTL-14). */
test.describe('Battle: история и результаты (B5)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('AC-BTL-14 history → results: podium, by question, hard questions, by student, CSV; class link filters', async ({
    page,
    baseURL,
  }) => {
    const game = await playedGame(page, baseURL!);

    // «Battle этого класса» из карточки класса → история, отфильтрованная по классу.
    await page.goto(`/ru/teacher/classes/${game.classId}/analytics`);
    await page.getByRole('link', { name: th.classLink }).click();
    await expect(page).toHaveURL(new RegExp(`tab=history&classId=${game.classId}`));
    const item = page.getByTestId('battle-history-item');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(th.status.finished);
    await expectNoSeriousA11yViolations(page);

    await item.getByRole('link', { name: th.results }).click();
    await expect(page).toHaveURL(new RegExp(`/battle-sessions/${game.sessionId}/results$`));
    await expect(page.getByTestId('battle-podium')).toContainText('Асель К.');
    const stats = page.getByTestId('battle-question-stat');
    await expect(stats).toHaveCount(2);
    await expect(stats.first()).toContainText('50 %');
    await expect(stats.nth(1)).toContainText('100 %');
    // Доля правильных ниже 50 % — нет; 50 % — не «сложный» (PH-30: < 50).
    await expect(page.getByTestId('battle-hard')).toHaveCount(0);

    // «По ученикам» — строка раскрывается ответами.
    const row = page.getByTestId('battle-student-row').filter({ hasText: 'Ержан С.' });
    await row.locator('summary').click();
    await expect(row).toContainText(tr.wrong);
    await expect(row).toContainText(tr.correct);
    expect(await hasHorizontalScroll(page)).toBe(false);
    await expectNoSeriousA11yViolations(page);

    // CSV: UTF-8 с BOM, «;», заголовок и 2 строки.
    const csv = await page.request.get(`/api/teacher/battle-sessions/${game.sessionId}/results.csv`);
    const text = await csv.text();
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain(`${ru.battle.csv.rank};${ru.battle.csv.student}`);
    expect(lines[1]).toContain('Асель К.');
  });
});
