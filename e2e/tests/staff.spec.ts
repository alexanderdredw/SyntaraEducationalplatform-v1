import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { acceptCookies, bundles, expectNoSeriousA11yViolations, isMobile } from './support';

const ru = bundles.ru;
const st = ru.staff;
const PASSWORD = process.env.SEED_DEV_PASSWORD ?? 'syntara-dev-password';
const ACCOUNTS = {
  support: 'support@syntara.local',
  onboarding: 'onboarding@syntara.local',
  teacher: 'teacher@syntara.local',
};

async function login(page: Page, email: string, path = '/ru/auth/login') {
  await page.goto(path);
  await page.getByRole('textbox', { name: ru.auth.login.email }).fill(email);
  await page.getByLabel(ru.auth.login.password).fill(PASSWORD);
  await page.getByRole('button', { name: ru.auth.login.submit }).click();
}

async function createTicket(request: APIRequestContext, subject: string) {
  const res = await request.post('/api/public/support-tickets', {
    headers: { 'Idempotency-Key': randomUUID() },
    data: {
      category: 'account_access',
      subject,
      email: 'staff-e2e@example.kz',
      description: 'Не могу войти',
      techContext: {
        route: '/ru/support',
        appVersion: '0.0.0',
        locale: 'ru',
        dataSaver: false,
        userAgent: 'e2e',
      },
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { publicNumber: string };
}

async function createRequest(request: APIRequestContext, schoolName: string) {
  const res = await request.post('/api/public/school-requests', {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { schoolName, contactPerson: 'Завуч', email: 'school-e2e@example.kz' },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { publicNumber: string };
}

async function openFromQueue(page: Page, searchLabel: string, number: string) {
  await page.getByLabel(searchLabel).fill(number);
  await page.getByRole('link', { name: number }).click();
}

test.describe('Вход и служебные очереди (8.5)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('REQ-SUP-01 guest is redirected from /staff to the login page with returnTo', async ({ page }) => {
    await page.goto('/ru/staff/tickets');
    await expect(page).toHaveURL(/\/ru\/auth\/login\?returnTo=%2Fstaff%2Ftickets$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ru.auth.login.title);
  });

  test('REQ-GEN-AUTH-01 login page: Email, Пароль, «Войти», «Забыли пароль?»; wrong password → error', async ({
    page,
  }) => {
    await page.goto('/ru/auth/login');
    await expect(page.getByRole('textbox', { name: ru.auth.login.email })).toBeVisible();
    await expect(page.getByLabel(ru.auth.login.password)).toHaveAttribute('type', 'password');
    await expect(page.getByRole('link', { name: ru.auth.login.forgot })).toBeVisible();
    await page.getByRole('textbox', { name: ru.auth.login.email }).fill(ACCOUNTS.support);
    await page.getByLabel(ru.auth.login.password).fill('wrong-password');
    await page.getByRole('button', { name: ru.auth.login.submit }).click();
    await expect(page.getByTestId('login-error')).toHaveText(ru.auth.login.invalid);
    await expectNoSeriousA11yViolations(page);
  });

  test('REQ-GEN-AUTH-01 after login: returnTo target; logout ends the session', async ({ page }) => {
    await login(page, ACCOUNTS.support, '/ru/auth/login?returnTo=%2Fstaff%2Ftickets');
    await expect(page).toHaveURL(/\/ru\/staff\/tickets$/);
    await expect(page.getByTestId('staff-user')).toHaveText('Demo Support');
    const nav = page.getByRole('navigation', { name: st.navLabel });
    await expect(nav.getByRole('link')).toHaveText([st.tickets]);

    await page.getByTestId('logout').click();
    await expect(page).toHaveURL(/\/ru$/);
    await page.goto('/ru/staff/tickets');
    await expect(page).toHaveURL(/\/ru\/auth\/login/);
  });

  test('BR-ACL-04 a teacher cannot open the staff queues (404); onboarding agent cannot open tickets', async ({
    page,
  }) => {
    await login(page, ACCOUNTS.teacher);
    await expect(page).toHaveURL(/\/ru\/teacher\/courses$/);
    const res = await page.goto('/ru/staff/tickets');
    expect(res?.status()).toBe(404);

    await page.context().clearCookies();
    await acceptCookies(page.context(), page.url());
    await login(page, ACCOUNTS.onboarding);
    await expect(page).toHaveURL(/\/ru\/staff\/requests$/);
    expect((await page.goto('/ru/staff/tickets'))?.status()).toBe(404);
  });

  test('AC-SUP-01 assign self, reply from a template (text and address visible first), internal note, resolve', async ({
    page,
    request,
  }) => {
    const subject = `E2E ${randomUUID().slice(0, 8)}`;
    const { publicNumber } = await createTicket(request, subject);
    await login(page, ACCOUNTS.support);
    await expect(page).toHaveURL(/\/ru\/staff\/tickets$/);
    await openFromQueue(page, st.filters.search, publicNumber);

    const card = page.getByTestId('ticket-card');
    await expect(card.getByRole('heading', { level: 2 })).toContainText(publicNumber);
    await expect(card.getByTestId('ticket-status')).toHaveText(st.ticketStatus.new);

    await card.getByRole('button', { name: st.actions.assignMe }).click();
    await expect(card.getByTestId('ticket-status')).toHaveText(st.ticketStatus.in_progress);
    await expect(card.getByTestId('ticket-assignee')).toHaveText('Demo Support');

    const reply = card.getByTestId('ticket-reply');
    await reply.getByLabel(st.actions.template).selectOption({ label: st.templates.confirmation });
    await expect(reply.getByLabel(st.actions.replyText)).toHaveValue(new RegExp(publicNumber));
    const preview = reply.getByTestId('reply-preview');
    await expect(preview).toContainText('staff-e2e@example.kz');
    await expect(preview).toContainText(publicNumber);
    await reply.getByRole('button', { name: st.actions.send }).click();
    const message = card.getByTestId('ticket-message');
    await expect(message).toHaveCount(1);
    await expect(message).toContainText(st.direction.out);

    const noteForm = card.getByTestId('ticket-note-form');
    await noteForm.getByLabel(st.actions.noteText).fill('Проверить журнал входов');
    await noteForm.getByRole('button', { name: st.actions.addNote }).click();
    const note = card.getByTestId('ticket-note');
    await expect(note).toContainText('Проверить журнал входов');
    await expect(note).toContainText(st.card.internal);
    // Заметка визуально отличается от сообщений клиенту (REQ-SUP-02).
    const style = (el: typeof note) => el.evaluate((n) => getComputedStyle(n).borderStyle);
    expect(await style(note)).toBe('dashed');
    expect(await style(message)).toBe('solid');

    await card.getByTestId('ticket-to-resolved').click();
    await expect(card.getByTestId('ticket-status')).toHaveText(st.ticketStatus.resolved);
    const history = card.getByTestId('ticket-history');
    await expect(history.getByRole('listitem')).toHaveCount(2);
    await expect(history).toContainText('Demo Support');
    await expect(card.getByText(st.actions.noStatusActions)).toBeVisible();
  });

  test('REQ-SUP-03 escalation goes to waiting_internal and back to work', async ({ page, request }) => {
    const { publicNumber } = await createTicket(request, `Escalate ${randomUUID().slice(0, 8)}`);
    await login(page, ACCOUNTS.support);
    await openFromQueue(page, st.filters.search, publicNumber);
    const card = page.getByTestId('ticket-card');
    await card.getByRole('button', { name: st.actions.assignMe }).click();
    await card.getByTestId('ticket-to-waiting_internal').click();
    await expect(card.getByTestId('ticket-status')).toHaveText(st.ticketStatus.waiting_internal);
    await card.getByTestId('ticket-to-in_progress').click();
    await expect(card.getByTestId('ticket-status')).toHaveText(st.ticketStatus.in_progress);
  });

  test('REQ-SUP-01 filters by status and search; list shows number, status and due date', async ({
    page,
    request,
  }) => {
    const { publicNumber } = await createTicket(request, `Filter ${randomUUID().slice(0, 8)}`);
    await login(page, ACCOUNTS.support);
    await page.getByLabel(st.filters.search).fill(publicNumber);
    const rows = page.getByTestId('ticket-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(st.ticketStatus.new);
    await page.getByLabel(st.filters.status).selectOption('resolved');
    await expect(page.getByText(st.empty)).toBeVisible();
    await page.getByRole('button', { name: st.filters.reset }).click();
    await expect(page.getByLabel(st.filters.search)).toHaveValue('');
  });

  test('API-SUP-07, SM-REQUEST onboarding agent moves a school request through its statuses', async ({
    page,
    request,
  }) => {
    const { publicNumber } = await createRequest(request, `Школа E2E ${randomUUID().slice(0, 6)}`);
    await login(page, ACCOUNTS.onboarding);
    await expect(page).toHaveURL(/\/ru\/staff\/requests$/);
    await openFromQueue(page, st.filters.search, publicNumber);
    const card = page.getByTestId('request-card');
    await expect(card.getByTestId('request-status')).toHaveText(st.requestStatus.new);
    await card.getByRole('button', { name: st.actions.assignMe }).click();
    await card.getByTestId('request-to-in_progress').click();
    await expect(card.getByTestId('request-status')).toHaveText(st.requestStatus.in_progress);
    await card.getByTestId('request-to-contacted').click();
    await card.getByTestId('request-to-onboarded').click();
    await expect(card.getByTestId('request-status')).toHaveText(st.requestStatus.onboarded);
    await expect(card.getByText(st.actions.noStatusActions)).toBeVisible();
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`REQ-NFR-A11Y-01 axe: staff queue with an open ticket in ${theme} theme`, async ({
      page,
      request,
      baseURL,
    }) => {
      await page.context().addCookies([{ name: 'theme', value: theme, url: baseURL! }]);
      const { publicNumber } = await createTicket(request, `Axe ${randomUUID().slice(0, 8)}`);
      await login(page, ACCOUNTS.support);
      await openFromQueue(page, st.filters.search, publicNumber);
      const card = page.getByTestId('ticket-card');
      await card.getByRole('button', { name: st.actions.assignMe }).click();
      await card.getByTestId('ticket-note-form').getByLabel(st.actions.noteText).fill('Заметка');
      await card.getByTestId('ticket-note-form').getByRole('button', { name: st.actions.addNote }).click();
      await expect(card.getByTestId('ticket-note')).toBeVisible();
      await expectNoSeriousA11yViolations(page);
      if (!isMobile(page)) {
        await page.goto('/ru/staff/tickets');
        await expectNoSeriousA11yViolations(page);
      }
    });
  }
});
