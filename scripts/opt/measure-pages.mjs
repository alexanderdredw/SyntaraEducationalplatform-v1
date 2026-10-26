// OPT-05: страницы и данные для замеров скорости (раздел 8 ТЗ) — общие для measure-web.mjs и lighthouse.mjs,
// чтобы «до/после» и Lighthouse мерили одно и то же. Данные (учитель, класс, ученик, свой предмет и тема, Battle)
// создаются через API; нужен api с RATE_LIMITS_DISABLED.
import { randomUUID } from 'node:crypto';

/** [роль, страница, путь или функция → путь (новая игра Battle на каждый прогон), storageState] */
export async function preparePages(browser, base) {
  async function userContext() {
    const ctx = await browser.newContext({ baseURL: base });
    await ctx.addCookies([{ name: 'consent', value: 'necessary', url: base }]);
    const page = await ctx.newPage();
    await page.goto('/ru');
    page.api = async (method, path, data) => {
      const csrf = (await ctx.cookies()).find((c) => c.name === 'csrf')?.value ?? '';
      const res = await page.request.fetch(path, { method, data, headers: { 'X-CSRF-Token': csrf } });
      if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${await res.text()}`);
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    };
    return { ctx, page };
  }

  const guestApi = (await userContext()).page;
  const catalog = await guestApi.api('GET', '/api/public/catalog');
  const firstSection = (catalog.sections ?? catalog)[0];
  const section = await guestApi.api('GET', `/api/public/sections/${firstSection.id}`);
  const baseSubject = await guestApi.api('GET', `/api/public/subjects/${section.subjects[0].id}`);
  const baseTopic = baseSubject.topics[0].id;

  const T = await userContext();
  await T.page.api('POST', '/api/auth/register', {
    role: 'teacher',
    email: `opt.${randomUUID().slice(0, 8)}@example.kz`,
    displayName: 'Учитель Замер',
    password: 'teacher-pass-1',
  });
  const cls = await T.page.api('POST', '/api/teacher/classes', { name: '9 «А»' });
  const invite = await T.page.api('POST', `/api/teacher/classes/${cls.id}/invite-codes`);
  const subject = await T.page.api('POST', '/api/teacher/subjects', {
    translations: { ru: { title: 'Биология (замер)', description: 'Предмет для замера скорости' } },
    inPublicCatalog: false,
  });
  const topic = await T.page.api('POST', `/api/teacher/subjects/${subject.id}/topics`);
  await T.page.api('POST', `/api/teacher/subjects/${subject.id}/access`, { classId: cls.id });
  const battle = await T.page.api('POST', '/api/teacher/battles', { title: 'Замер', locale: 'ru' });
  await T.page.api('POST', `/api/teacher/battles/${battle.id}/questions`, {
    type: 'single_choice',
    text: 'Сколько камер в сердце человека?',
    timeLimitSec: 90,
    options: ['Две', 'Три', 'Четыре'].map((t, i) => ({ text: t, isCorrect: i === 2 })),
  });
  await T.page.api('POST', `/api/teacher/battles/${battle.id}/questions`, {
    type: 'true_false',
    text: 'Сердце — это мышца',
    timeLimitSec: 90,
    options: [
      { text: '', isCorrect: true },
      { text: '', isCorrect: false },
    ],
  });

  const S = await userContext();
  await S.page.api('POST', '/api/auth/register-student', {
    displayName: 'Ученик Замер',
    login: `opt.${randomUUID().slice(0, 8)}`,
    password: 'student-pass-1',
    code: invite.code,
  });

  const lobby = await T.page.api('POST', `/api/teacher/battles/${battle.id}/sessions`, { classId: cls.id });
  await S.page.api('POST', '/api/student/battles/join', { code: lobby.code });
  // Вопрос длится не больше 90 с — для каждого прогона «вопроса» запускается новая игра.
  // Не больше 3 активных игр у учителя (BATTLE_MAX_ACTIVE_SESSIONS) — предыдущая завершается.
  let previous = null;
  async function liveSession() {
    if (previous) {
      const s = await T.page.api('GET', `/api/teacher/battle-sessions/${previous}`);
      await T.page.api('POST', `/api/teacher/battle-sessions/${previous}/finish`, {
        expectedVersion: s.version,
      });
    }
    const live = await T.page.api('POST', `/api/teacher/battles/${battle.id}/sessions`, { classId: cls.id });
    await S.page.api('POST', '/api/student/battles/join', { code: live.code });
    const snap = await T.page.api('GET', `/api/teacher/battle-sessions/${live.sessionId}`);
    await T.page.api('POST', `/api/teacher/battle-sessions/${live.sessionId}/start`, {
      expectedVersion: snap.version,
    });
    previous = live.sessionId;
    return live.sessionId;
  }

  const guest = { cookies: [] };
  const teacherState = await T.ctx.storageState();
  const studentState = await S.ctx.storageState();

  const PAGES = [
    ['гость', 'Главная', '/ru', guest],
    ['гость', 'Предметы', '/ru/subjects', guest],
    ['гость', 'О проекте', '/ru/about', guest],
    ['гость', 'Урок базового предмета', `/ru/learn/topics/${baseTopic}`, guest],
    ['ученик', 'Каталог', '/ru/learn/subjects', studentState],
    ['ученик', 'Мой класс', '/ru/learn/class', studentState],
    ['ученик', 'Урок — Обзор', `/ru/learn/topics/${baseTopic}`, studentState],
    ['ученик', 'Урок — Квиз', `/ru/learn/topics/${baseTopic}?tab=quiz`, studentState],
    ['ученик', 'Показатели', '/ru/learn/progress', studentState],
    ['ученик', 'Достижения', '/ru/learn/achievements', studentState],
    ['ученик', 'Battle — лобби', `/ru/learn/battles/${lobby.sessionId}`, studentState],
    ['ученик', 'Battle — вопрос', async () => `/ru/learn/battles/${await liveSession()}`, studentState],
    ['ученик', 'Профиль', '/ru/account', studentState],
    ['учитель', 'Мои курсы', '/ru/teacher/courses', teacherState],
    ['учитель', 'Редактор темы', `/ru/teacher/topics/${topic.id}`, teacherState],
    ['учитель', 'Аналитика класса', `/ru/teacher/classes/${cls.id}/analytics`, teacherState],
    ['учитель', 'Карта освоения', `/ru/teacher/classes/${cls.id}/mastery`, teacherState],
    [
      'учитель',
      'Экран ведущего Battle (вопрос)',
      async () => `/ru/teacher/battle-sessions/${await liveSession()}`,
      teacherState,
    ],
  ];
  return PAGES;
}
