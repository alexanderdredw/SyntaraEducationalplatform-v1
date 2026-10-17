import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';
import { bundles, expectNoSeriousA11yViolations, hasHorizontalScroll } from './support';

const ru = bundles.ru;
const st = ru.student;
const ROOT = join(__dirname, '..', '..');
const DIGESTIVE = 'biology/01-human-anatomy/03-digestive-system';

/** ID базовой программы — через гостевой API (API-PUB-10..12). */
async function baseIds(api: APIRequestContext) {
  const catalog = await (await api.get('/api/public/catalog')).json();
  const biology = catalog.sections.find((s: { title: string }) => s.title === 'Биология');
  const section = await (await api.get(`/api/public/sections/${biology.id}`)).json();
  const anatomy = section.subjects.find((s: { title: string }) => s.title === 'Анатомия человека');
  const subject = await (await api.get(`/api/public/subjects/${anatomy.id}`)).json();
  const topic = (title: string) =>
    subject.topics.find((t: { title: string }) => t.title === title).id as string;
  return {
    sectionId: biology.id as string,
    subjectId: anatomy.id as string,
    cardio: topic('Сердечно-сосудистая система'),
    digestive: topic('Пищеварительная система'),
  };
}

/** Этап 8.6 — базовая программа (AC-CNT-01..07, BR-VIS-04, REQ-ST-LES-06/07). */
test.describe('Базовая программа платформы (этап 8.6)', () => {
  test('AC-CNT-01, BR-VIS-04, REQ-ST-LES-06 a guest reads the catalog and the overview of a base lesson; quiz and AI invite to log in', async ({
    page,
    baseURL,
  }) => {
    const ids = await baseIds(await request.newContext({ baseURL }));
    // /subjects → «Биология» → «Анатомия человека» → урок — без входа, в публичной оболочке.
    await page.goto('/ru/subjects');
    await page.getByTestId('subject-card').first().getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/ru/learn/sections/${ids.sectionId}$`));
    await expect(page.getByTestId('header-login')).toBeVisible();
    const subjects = page.getByTestId('catalog-subject');
    await expect(subjects.filter({ hasText: 'Общая биология' })).toHaveAttribute('data-status', 'soon');
    await expect(subjects.filter({ hasText: 'Общая биология' }).getByRole('link')).toHaveCount(0);
    await subjects.filter({ hasText: 'Анатомия человека' }).click();
    await expect(page.getByTestId('student-topic')).toHaveCount(3);
    await expect(page.getByTestId('student-topic').first()).not.toHaveAttribute('data-status');
    await page.getByTestId('student-topic').first().click();

    await expect(page.getByRole('heading', { level: 1, name: 'Сердечно-сосудистая система' })).toBeVisible();
    await expect(page.getByTestId('lesson-overview')).toContainText(
      'Сердце и сосуды, обеспечивающие кровообращение.',
    );
    await expect(page.getByTestId('lesson-fun-fact')).toBeVisible();
    const sections = page.getByTestId('lesson-overview').getByRole('button');
    await expect(sections).toHaveCount(5);
    await sections.filter({ hasText: 'Строение сердца' }).click();
    const illustration = page.getByTestId('section-illustration');
    await expect(illustration).toHaveAttribute('alt', /Схема сердца/);
    // Иллюстрация раздела: ~336 px на десктопе, во всю ширину на мобильном (решение владельца 2026-10-17).
    const width = (await illustration.boundingBox())!.width;
    const viewport = page.viewportSize()!.width;
    if (viewport >= 768) expect(Math.round(width)).toBe(336);
    else expect(width).toBeGreaterThan(viewport * 0.7);
    await expectNoSeriousA11yViolations(page);
    expect(await hasHorizontalScroll(page)).toBe(false);

    // Квиз и Syntara AI — приглашение войти с возвратом на вкладку.
    for (const tab of ['quiz', 'ai'] as const) {
      await page.getByRole('tab', { name: st.lesson[tab] }).click();
      const invite = page.getByTestId('guest-invite');
      await expect(invite).toContainText(tab === 'ai' ? st.lesson.guestInviteAi : st.lesson.guestInvite);
      await expect(invite.getByTestId('guest-login')).toHaveAttribute(
        'href',
        `/ru/auth/login?returnTo=${encodeURIComponent(`/learn/topics/${ids.cardio}?tab=${tab}`)}`,
      );
    }
    await expect(page.getByTestId('student-quiz')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
  });

  test('REQ-ST-LES-07, BR-CNT-05 language marks: KK — «На проверке»; EN has its own sixth section', async ({
    page,
    baseURL,
  }) => {
    const ids = await baseIds(await request.newContext({ baseURL }));
    await page.goto(`/kk/learn/topics/${ids.cardio}`);
    await expect(page.getByTestId('lesson-needs-review')).toHaveText(bundles.kk.student.lesson.needsReview);
    await page.goto(`/en/learn/topics/${ids.cardio}`);
    await expect(page.getByTestId('lesson-overview').getByRole('button')).toHaveCount(6);
    await expect(page.getByTestId('lesson-overview')).toContainText('Microcirculation');
  });

  test('AC-CNT-02 a student passes the quiz of a base lesson and gets XP', async ({
    page,
    context,
    baseURL,
  }) => {
    const ctx = await request.newContext({ baseURL });
    const res = await ctx.post('/api/auth/register-student', {
      data: { displayName: 'Асель', login: `bs.${randomUUID().slice(0, 8)}`, password: 'student-pass-1' },
    });
    expect(res.status()).toBe(201);
    const { cookies } = await ctx.storageState();
    await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseURL! })));
    const ids = await baseIds(ctx);

    await page.goto(`/ru/learn/topics/${ids.cardio}?tab=quiz`);
    const answer = async (q: Page) => {
      await expect(q.getByTestId('quiz-feedback')).toContainText(st.quiz.correct);
      await q.getByTestId('quiz-next').click();
    };
    // Порядок вопросов — как в quiz.yaml; правильные: «Аорта», «4», «Левый желудочек», «Неверно», малый круг.
    await page.getByTestId('quiz-option').filter({ hasText: 'Аорта' }).click();
    await answer(page);
    await page.getByLabel(st.quiz.answerLabel).fill('4');
    await page.getByRole('button', { name: st.quiz.answer }).click();
    await answer(page);
    await page.getByTestId('quiz-option').filter({ hasText: 'Левый желудочек' }).click();
    await answer(page);
    await page.getByTestId('quiz-option').filter({ hasText: ru.teacher.quiz.optionFalse }).click();
    await answer(page);
    await page.getByTestId('quiz-option').filter({ hasText: 'В малом (лёгочном)' }).click();
    await answer(page);
    await expect(page.getByTestId('quiz-result')).toContainText(st.quiz.result.replace('{score}', '100'));
    await expect(page.getByTestId('quiz-mastery')).toHaveText(st.quiz.masteredYes);
    await expect(page.getByTestId('quiz-xp')).toBeVisible();
    await expect(page.getByTestId('cabinet-stats')).not.toContainText(' 0 XP');
  });

  test('AC-CNT-03, BR-ACL-05 a teacher cannot change a base lesson: no editor, API answers 404', async ({
    page,
    context,
    baseURL,
  }) => {
    const teacher = await request.newContext({ baseURL });
    const reg = await teacher.post('/api/auth/register', {
      data: {
        role: 'teacher',
        email: `bt.${randomUUID().slice(0, 8)}@example.kz`,
        displayName: 'Учитель',
        password: 'teacher-pass-1',
      },
    });
    expect(reg.status()).toBe(201);
    const ids = await baseIds(teacher);
    const csrf = (await teacher.storageState()).cookies.find((c) => c.name === 'csrf')!.value;
    const headers = { 'X-CSRF-Token': csrf };
    expect(
      (
        await teacher.put(`/api/teacher/topics/${ids.cardio}`, {
          data: { translations: { ru: { title: 'Изменено' } }, materialIds: [] },
          headers,
        })
      ).status(),
    ).toBe(404);
    expect((await teacher.post(`/api/teacher/topics/${ids.cardio}/unpublish`, { headers })).status()).toBe(
      404,
    );
    expect(
      (
        await teacher.patch(`/api/teacher/subjects/${ids.subjectId}`, {
          data: { translations: { ru: { title: 'Изменено' } } },
          headers,
        })
      ).status(),
    ).toBe(404);
    const { cookies } = await teacher.storageState();
    await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseURL! })));
    expect((await page.goto(`/ru/teacher/subjects/${ids.subjectId}`))?.status()).toBe(404);
    expect((await page.goto(`/ru/teacher/topics/${ids.cardio}`))?.status()).toBe(404);
    const lesson = await (await request.newContext({ baseURL })).get(`/api/public/topics/${ids.cardio}`);
    expect((await lesson.json()).title).toBe('Сердечно-сосудистая система');
  });

  test('AC-CNT-04..06 import: a re-run changes nothing; a changed file → new version; a broken file changes nothing', async ({
    baseURL,
  }, testInfo) => {
    // Импорт меняет общую БД e2e — один проект, последовательно.
    test.skip(testInfo.project.name !== 'desktop-1440', 'импорт выполняется один раз');
    test.setTimeout(180_000);
    const guest = await request.newContext({ baseURL });
    const ids = await baseIds(guest);
    const funFact = async () =>
      (await (await guest.get(`/api/public/topics/${ids.digestive}`)).json()).funFact;
    const dir = mkdtempSync(join(tmpdir(), 'syntara-e2e-content-'));
    // Сводка и ошибки CLI пишет в stderr — читаем оба потока.
    const run = (from: string) => {
      const r = spawnSync(`pnpm --filter @syntara/db content:import --dir="${from}"`, {
        cwd: ROOT,
        encoding: 'utf8',
        shell: true,
      });
      return { code: r.status, out: `${r.stdout}${r.stderr}` };
    };
    try {
      cpSync(join(ROOT, 'content'), dir, { recursive: true });
      const original = await funFact();
      const again = run(dir);
      expect(again.code, again.out).toBe(0);
      expect(again.out).toContain('изменений нет');

      const ruMd = join(dir, DIGESTIVE, 'ru.md');
      const text = readFileSync(ruMd, 'utf8');
      const changed = `Изменённый факт e2e ${randomUUID().slice(0, 8)}.`;
      writeFileSync(ruMd, text.replace(/^funFact: .*$/m, `funFact: ${changed}`));
      const updated = run(dir);
      expect(updated.code, updated.out).toBe(0);
      expect(updated.out).toMatch(/versions 1/);
      expect(await funFact()).toBe(changed);

      const quiz = join(dir, DIGESTIVE, 'quiz.yaml');
      writeFileSync(quiz, readFileSync(quiz, 'utf8').replace('difficulty: easy', 'difficulty: impossible'));
      writeFileSync(ruMd, text.replace(/^funFact: .*$/m, 'funFact: Не должно попасть в базу.'));
      const broken = run(dir);
      expect(broken.code).not.toBe(0);
      expect(broken.out).toContain('quiz.yaml');
      expect(broken.out).toContain('БД не изменена');
      expect(await funFact()).toBe(changed);

      // Вернуть базовую программу из репозитория.
      const restored = run(join(ROOT, 'content'));
      expect(restored.code, restored.out).toBe(0);
      expect(await funFact()).toBe(original);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
