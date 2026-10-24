import { randomInt, randomUUID } from 'node:crypto';
import { expect, request, test, type Page } from '@playwright/test';
import { acceptCookies, bundles, expectNoSeriousA11yViolations } from './support';
import { insertLegacyClassCode } from './db';

const ru = bundles.ru;
const uid = () => randomUUID().slice(0, 8);
/** Буквы алфавита PH-07 (без I и O): код подходит и как код класса, и по формату Battle. */
const PH07_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const pick = (chars: string, n: number) =>
  Array.from({ length: n }, () => chars[randomInt(chars.length)]).join('');
/** Текст подсказки без разметки ссылки `<link>…</link>`. */
const plain = (text: string) => text.replace(/<\/?link>/g, '');

/** Учитель — отдельный контекст запросов: класс, код приглашения, Battle-тест и сессия. */
async function teacherApi(baseURL: string) {
  const api = await request.newContext({ baseURL });
  const res = await api.post('/api/auth/register', {
    data: {
      role: 'teacher',
      email: `codes.t.${uid()}@example.kz`,
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
  const get = async (path: string) => (await api.get(path)).json();
  return { api, post, get };
}

type Teacher = Awaited<ReturnType<typeof teacherApi>>;

async function classWithCode(t: Teacher) {
  const cls = await t.post('/api/teacher/classes', { name: `7 «${uid()}»` });
  const invite = await t.post(`/api/teacher/classes/${cls.id}/invite-codes`);
  return { id: cls.id as string, code: invite.code as string };
}

async function battleSession(t: Teacher, classId: string) {
  const battle = await t.post('/api/teacher/battles', { title: 'Коды', locale: 'ru' });
  await t.post(`/api/teacher/battles/${battle.id}/questions`, {
    type: 'single_choice',
    text: 'Вопрос',
    timeLimitSec: 60,
    options: ['A', 'B'].map((l, p) => ({ text: `Вариант ${l}`, isCorrect: p === 0 })),
  });
  const session = await t.post(`/api/teacher/battles/${battle.id}/sessions`, { classId });
  return session.code as string;
}

async function signUpStudent(page: Page, classCode?: string) {
  const res = await page.request.post('/api/auth/register-student', {
    data: {
      displayName: 'Асель Каримова',
      login: `codes.s.${uid()}`,
      password: 'student-pass-1',
      ...(classCode ? { code: classCode } : {}),
    },
  });
  expect(res.status()).toBe(201);
}

async function typeBattleCode(page: Page, code: string) {
  const join = page.getByTestId('battle-join');
  await join.getByLabel(ru.battle.student.join.cell.replace('{n}', '1')).click();
  await page.keyboard.type(code);
  await join.getByRole('button', { name: ru.battle.student.join.submit }).click();
  return join;
}

/** CODES_TZ, раздел 5 (e2e): поля кода класса и кода Battle различимы, ввод «не туда» — подсказка со ссылкой. */
test.describe('Коды класса и Battle (CODES_TZ)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('BR-CODE-04 AC-CODE-01 AC-CODE-06 AC-CODE-07 Battle code in «Подключиться к классу» → hint with a Battle link, not added; existing class intact', async ({
    page,
    browser,
    baseURL,
  }) => {
    const teacher = await teacherApi(baseURL!);
    // Уже существующий класс с учениками — должен остаться как был (BR-CODE-05).
    const existing = await classWithCode(teacher);
    for (let i = 0; i < 2; i++) {
      const ctx = await browser.newContext({ baseURL });
      await signUpStudent(await ctx.newPage(), existing.code);
      await ctx.close();
    }
    const host = await classWithCode(teacher);
    const battleCode = await battleSession(teacher, host.id);

    await signUpStudent(page);
    await page.goto('/ru/learn/class');
    const card = page.getByTestId('student-join');
    await card.getByLabel(ru.join.codeLabel).fill(battleCode);
    await card.getByRole('button', { name: ru.student.class.joinSubmit }).click();
    await page.getByRole('dialog').getByRole('button', { name: ru.join.confirm }).click();
    const alert = card.getByRole('alert');
    await expect(alert).toHaveText(plain(ru.join.isBattleCode));
    await expect(alert.getByRole('link')).toHaveAttribute('href', '/ru/learn/battles');
    await expectNoSeriousA11yViolations(page);
    // В класс не добавлен.
    expect(await (await page.request.get('/api/student/class')).json()).toBeNull();

    // Гость на /join: подсказка ведёт на вход ученика.
    const guest = await browser.newPage({ baseURL });
    await acceptCookies(guest.context(), baseURL);
    await guest.goto('/ru/join');
    await guest.getByLabel(ru.join.codeLabel).fill(battleCode.toLowerCase());
    await guest.getByRole('button', { name: ru.join.check }).click();
    const hint = guest.getByTestId('join-battle-code');
    await expect(hint).toHaveText(plain(ru.join.isBattleCode));
    await expect(hint.getByRole('link')).toHaveAttribute('href', '/ru/auth/start?role=student');
    await guest.close();

    // Существующий класс: оба ученика на месте, код по-прежнему действует.
    expect(await teacher.get(`/api/teacher/classes/${existing.id}/roster`)).toHaveLength(2);
    const anonymous = await request.newContext({ baseURL });
    const check = await anonymous.post('/api/public/join/check', { data: { code: existing.code } });
    expect(await check.json()).toEqual({ valid: true });
    await anonymous.dispose();
  });

  test('BR-CODE-04 AC-CODE-02 AC-CODE-07 class code in the Battle field → hint with a link to «Подключиться к классу»', async ({
    page,
    baseURL,
  }) => {
    const teacher = await teacherApi(baseURL!);
    const cls = await classWithCode(teacher);
    await battleSession(teacher, cls.id);
    // Старый код класса вида LLLDDD (до BR-CODE-03 такие коды могли выпускаться).
    const legacy = pick(PH07_LETTERS, 3) + pick('23456789', 3);
    await insertLegacyClassCode(cls.id, legacy);

    await signUpStudent(page, cls.code);
    await page.goto('/ru/learn/battles');
    let join = await typeBattleCode(page, legacy.toLowerCase());
    await expect(join.getByRole('alert')).toHaveText(plain(ru.battle.student.errors.isClassCode));
    await expect(join.getByRole('alert').getByRole('link')).toHaveAttribute('href', '/ru/join');
    await expectNoSeriousA11yViolations(page);

    // Обычный код класса — не формат Battle: «код не найден», в игру не входит.
    await page.reload();
    join = await typeBattleCode(page, cls.code);
    await expect(join.getByRole('alert')).toHaveText(ru.battle.student.errors.codeNotFound);
    await expect(page).toHaveURL(/\/ru\/learn\/battles$/);
  });

  for (const locale of ['ru', 'kk', 'en'] as const) {
    test(`BR-CODE-07 AC-CODE-09 fields differ: label, example, hint, icon (${locale.toUpperCase()})`, async ({
      page,
    }) => {
      const t = bundles[locale];
      await signUpStudent(page);

      await page.goto(`/${locale}/learn/class`);
      const card = page.getByTestId('student-join');
      await expect(card.getByRole('heading', { name: t.student.class.join })).toBeVisible();
      const classField = card.getByLabel(t.join.codeLabel);
      await expect(classField).toHaveAttribute('placeholder', '7KQ2MP');
      await expect(card.getByText(t.join.codeHint)).toBeVisible();
      await expect(card.locator('label svg.lucide-users')).toBeVisible();
      await expect(card.locator('svg.lucide-zap')).toHaveCount(0);

      await page.goto(`/${locale}/learn/battles`);
      const battle = page.getByTestId('battle-join');
      await expect(battle.getByRole('group', { name: t.battle.student.join.codeLabel })).toBeVisible();
      await expect(battle.getByText(t.battle.student.join.codeLabel, { exact: true })).toBeVisible();
      for (const [i, ch] of [...'KTR583'].entries())
        await expect(
          battle.getByLabel(t.battle.student.join.cell.replace('{n}', String(i + 1))),
        ).toHaveAttribute('placeholder', ch);
      await expect(battle.getByText(t.battle.student.join.hint)).toBeVisible();
      await expect(battle.locator('svg.lucide-zap')).toBeVisible();
      await expect(battle.locator('svg.lucide-users')).toHaveCount(0);
      expect(t.battle.student.join.codeLabel).not.toBe(t.join.codeLabel);
    });
  }

  test('BR-CODE-07 registration and /join use the class code example 7KQ2MP instead of ABC123', async ({
    page,
  }) => {
    await page.goto('/ru/auth/start?role=student');
    await expect(page.locator('#student-code')).toHaveAttribute('placeholder', '7KQ2MP');
    await page.goto('/ru/join');
    await expect(page.getByLabel(ru.join.codeLabel)).toHaveAttribute('placeholder', '7KQ2MP');
    for (const l of ['ru', 'kk', 'en'] as const) {
      expect(JSON.stringify(bundles[l])).not.toContain('ABC123');
    }
  });
});
