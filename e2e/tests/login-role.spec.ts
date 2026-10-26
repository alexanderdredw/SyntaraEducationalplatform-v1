import { randomUUID } from 'node:crypto';
import { expect, request, test, type Page } from '@playwright/test';
import { acceptCookies, bundles } from './support';

type Locale = 'ru' | 'kk' | 'en';
const ru = bundles.ru;

/** Текст сообщения без разметки ссылки (`<link>…</link>`). */
const plain = (text: string) => text.replace(/<\/?link>/g, '');
const linkText = (text: string) => /<link>(.*?)<\/link>/.exec(text)![1]!;

async function accounts(baseURL: string) {
  const id = randomUUID().slice(0, 8);
  const api = await request.newContext({ baseURL });
  expect(
    (
      await api.post('/api/auth/register-student', {
        data: { displayName: 'Асель', login: `lr.${id}`, password: 'student-pass-1' },
      })
    ).status(),
  ).toBe(201);
  const teacher = await request.newContext({ baseURL });
  expect(
    (
      await teacher.post('/api/auth/register', {
        data: {
          role: 'teacher',
          email: `lr.${id}@example.kz`,
          displayName: 'Учитель',
          password: 'teacher-pass-1',
        },
      })
    ).status(),
  ).toBe(201);
  await api.dispose();
  await teacher.dispose();
  return { studentLogin: `lr.${id}`, teacherEmail: `lr.${id}@example.kz` };
}

/** Вкладка «Вход» экрана учителя (та же карточка, что у ученика). */
async function fillTeacherLogin(page: Page, locale: Locale, email: string, password: string) {
  const ta = bundles[locale].teacherAuth;
  const card = page.getByTestId('teacher-auth');
  await card.getByRole('textbox', { name: ta.loginEmail, exact: true }).fill(email);
  await card.getByLabel(ta.password, { exact: true }).fill(password);
  await card.getByRole('button', { name: ta.loginSubmit }).click();
}

async function teacherForm(page: Page, locale: Locale, email: string, password: string, returnTo?: string) {
  await page.goto(
    `/${locale}/auth/login?role=teacher${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ''}`,
  );
  await fillTeacherLogin(page, locale, email, password);
}

async function studentForm(page: Page, locale: Locale, identifier: string, password: string) {
  const sa = bundles[locale].studentAuth;
  await page.goto(`/${locale}/auth/start?role=student`);
  const card = page.getByTestId('student-auth');
  await card.getByRole('tab', { name: sa.tabLogin }).click();
  await card.getByRole('textbox', { name: sa.identifier }).fill(identifier);
  await card.getByLabel(sa.password, { exact: true }).fill(password);
  await card.getByRole('button', { name: sa.loginSubmit }).click();
}

const signedIn = async (page: Page) => (await page.request.get('/api/me')).status() === 200;

test.describe('Вход по роли формы (BR-AUTH-01)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  for (const locale of ['ru', 'kk', 'en'] as const) {
    test(`BR-AUTH-01 ${locale}: a student in «Я учитель» and a teacher in «Я ученик» → message with a link; no session`, async ({
      page,
      baseURL,
    }) => {
      const t = bundles[locale].auth.login;
      const { studentLogin, teacherEmail } = await accounts(baseURL!);

      await teacherForm(page, locale, studentLogin, 'student-pass-1');
      const toStudent = page.getByTestId('login-wrong-role');
      await expect(toStudent).toHaveText(plain(t.wrongRoleStudent));
      await expect(toStudent.getByRole('link', { name: linkText(t.wrongRoleStudent) })).toHaveAttribute(
        'href',
        `/${locale}/auth/start?role=student`,
      );
      expect(await signedIn(page)).toBe(false);

      await studentForm(page, locale, teacherEmail, 'teacher-pass-1');
      const toTeacher = page.getByTestId('student-login-wrong-role');
      await expect(toTeacher).toHaveText(plain(t.wrongRoleTeacher));
      await expect(toTeacher.getByRole('link', { name: linkText(t.wrongRoleTeacher) })).toHaveAttribute(
        'href',
        `/${locale}/auth/login?role=teacher`,
      );
      expect(await signedIn(page)).toBe(false);

      // Ссылка ведёт в форму нужной роли, где этот аккаунт входит.
      await toTeacher.getByRole('link').click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/auth/login\\?role=teacher$`));
      await fillTeacherLogin(page, locale, teacherEmail, 'teacher-pass-1');
      await expect(page).toHaveURL(new RegExp(`/${locale}/teacher/courses$`));
    });
  }

  test('BR-AUTH-01 matching forms sign in; a wrong password gives the same general message in both forms', async ({
    page,
    baseURL,
  }) => {
    const { studentLogin, teacherEmail } = await accounts(baseURL!);
    await teacherForm(page, 'ru', studentLogin, 'wrong-pass-1');
    await expect(page.getByTestId('login-error')).toHaveText(ru.auth.login.invalid);
    await expect(page.getByTestId('login-wrong-role')).toHaveCount(0);
    await studentForm(page, 'ru', teacherEmail, 'wrong-pass-1');
    await expect(page.getByTestId('student-login-error')).toHaveText(ru.auth.login.invalid);
    await expect(page.getByTestId('student-login-wrong-role')).toHaveCount(0);

    await studentForm(page, 'ru', studentLogin, 'student-pass-1');
    await expect(page).toHaveURL(/\/ru\/learn\/subjects$/);
    expect(await signedIn(page)).toBe(true);
  });

  test('BR-AUTH-01 /auth/login without a role → «Как продолжить?»; returnTo is kept through the choice', async ({
    page,
    baseURL,
  }) => {
    await page.goto('/ru/auth/login');
    await expect(page).toHaveURL(/\/ru\/auth\/start$/);
    await expect(page.getByTestId('continue-choice')).toBeVisible();

    const back = encodeURIComponent('/account/privacy');
    await page.goto(`/ru/auth/login?returnTo=${back}`);
    await expect(page).toHaveURL(new RegExp(`/ru/auth/start\\?returnTo=${back}$`));
    await expect(page.getByTestId('start-student')).toHaveAttribute(
      'href',
      `/ru/auth/start?role=student&returnTo=${back}`,
    );
    await expect(page.getByTestId('start-teacher')).toHaveAttribute(
      'href',
      `/ru/auth/start?role=teacher&returnTo=${back}`,
    );
    // Экран учителя: вкладка «Вход» на той же странице сохраняет возврат.
    const { teacherEmail: early } = await accounts(baseURL!);
    await page.getByTestId('start-teacher').click();
    await expect(page).toHaveURL(new RegExp(`/ru/auth/start\\?role=teacher&returnTo=${back}$`));
    await page.getByTestId('teacher-auth').getByRole('tab', { name: ru.teacherAuth.tabLogin }).click();
    await fillTeacherLogin(page, 'ru', early, 'teacher-pass-1');
    await expect(page).toHaveURL(/\/ru\/account\/privacy$/);
    await page.context().clearCookies();
    await acceptCookies(page.context(), baseURL);

    // «Войти» в хедере и футере — выбор роли.
    await page.goto('/ru');
    await expect(page.getByTestId('site-footer').getByRole('link', { name: ru.shell.login })).toHaveAttribute(
      'href',
      '/ru/auth/start',
    );

    // Учитель с возвратом в кабинет — после входа на нужной странице.
    const { teacherEmail } = await accounts(baseURL!);
    await teacherForm(page, 'ru', teacherEmail, 'teacher-pass-1', '/teacher/classes');
    await expect(page).toHaveURL(/\/ru\/teacher\/classes$/);
  });
});
