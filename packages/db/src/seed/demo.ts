import { and, eq, isNotNull } from 'drizzle-orm';
import { type Database } from '../index';
import { formatError, importContent, type MediaStore } from '../content';
import {
  badges,
  badgeTranslations,
  catalogSections,
  levels,
  levelTranslations,
  questions,
  quizzes,
  responseTemplates,
  subjects,
  topics,
  userPreferences,
  userProfiles,
  userRoles,
  schools,
  users,
} from '../schema';
import { seedId } from './ids';
import { assertNotProduction, hashPassword, rows, type Tr } from './helpers';
import { profileFor, stableAvatarColor } from '../profiles';

/**
 * Seed `demo`: справочники, учётные записи для разработки и базовая программа платформы — импортом файлов
 * content/ (решение владельца 2026-10-16, BR-CNT-01): каталог, «Анатомия человека», пробный вопрос PH-02.
 * Тексты RU — дословно из SPEC; KK и EN — подготовленные переводы (KK — needs_review, см. seed/content_review.json).
 */

/** BR-XP-03: уровень 1 — «Новичок», иначе «Уровень N»; порог = 100 × (N − 1) (PH-39 per_level). Уровни до 10 (бейдж legend). */
const LEVEL_COUNT = 10;

type Rule = Record<string, unknown>;
const BADGES: Array<{ code: string; rule: Rule; tr: Tr<{ title: string; conditionText: string }> }> = [
  {
    code: 'first_step',
    rule: { event: 'quiz_finished', count: 1 },
    tr: {
      ru: { title: 'Первый шаг', conditionText: 'Пройден первый квиз' },
      kk: { title: 'Алғашқы қадам', conditionText: 'Алғашқы квиз тапсырылды' },
      en: { title: 'First step', conditionText: 'First quiz completed' },
    },
  },
  {
    code: 'warmup',
    rule: { streak: 3 },
    tr: {
      ru: { title: 'Разогрев', conditionText: 'Серия из 3 дней подряд' },
      kk: { title: 'Қыздыру', conditionText: 'Қатарынан 3 күндік серия' },
      en: { title: 'Warm-up', conditionText: '3-day streak' },
    },
  },
  {
    code: 'week_power',
    rule: { streak: 7 },
    tr: {
      ru: { title: 'Неделя силы', conditionText: 'Серия из 7 дней подряд' },
      kk: { title: 'Күшті апта', conditionText: 'Қатарынан 7 күндік серия' },
      en: { title: 'Power week', conditionText: '7-day streak' },
    },
  },
  {
    code: 'marathon',
    rule: { streak: 30 },
    tr: {
      ru: { title: 'Марафонец', conditionText: 'Серия из 30 дней подряд' },
      kk: { title: 'Марафоншы', conditionText: 'Қатарынан 30 күндік серия' },
      en: { title: 'Marathoner', conditionText: '30-day streak' },
    },
  },
  {
    code: 'topic_mastered',
    rule: { masteredTopics: 1 },
    tr: {
      ru: { title: 'Тема освоена', conditionText: 'Первая тема пройдена на 80%+' },
      kk: { title: 'Тақырып меңгерілді', conditionText: 'Алғашқы тақырып 80%+ нәтижемен өтілді' },
      en: { title: 'Topic mastered', conditionText: 'First topic completed with 80%+' },
    },
  },
  {
    code: 'five_topics',
    rule: { masteredTopics: 5 },
    tr: {
      ru: { title: 'Пятёрка знаний', conditionText: '5 тем освоено' },
      kk: { title: 'Білім бестігі', conditionText: '5 тақырып меңгерілді' },
      en: { title: 'Knowledge five', conditionText: '5 topics mastered' },
    },
  },
  {
    code: 'erudition',
    rule: { masteredTopics: 10 },
    tr: {
      ru: { title: 'Эрудиция', conditionText: '10 тем освоено' },
      kk: { title: 'Білімдарлық', conditionText: '10 тақырып меңгерілді' },
      en: { title: 'Erudition', conditionText: '10 topics mastered' },
    },
  },
  {
    code: 'subject_conquered',
    rule: { subjectAllTopicsMastered: true },
    tr: {
      ru: { title: 'Предмет покорён', conditionText: 'Все темы предмета освоены' },
      kk: { title: 'Пән бағындырылды', conditionText: 'Пәннің барлық тақырыбы меңгерілді' },
      en: { title: 'Subject conquered', conditionText: 'All topics of a subject mastered' },
    },
  },
  {
    code: 'erudite',
    rule: { level: 5 },
    tr: {
      ru: { title: 'Эрудит', conditionText: 'Достигнут 5-й уровень' },
      kk: { title: 'Білімпаз', conditionText: '5-деңгейге жетті' },
      en: { title: 'Erudite', conditionText: 'Reached level 5' },
    },
  },
  {
    code: 'legend',
    rule: { level: 10 },
    tr: {
      ru: { title: 'Легенда', conditionText: 'Достигнут 10-й уровень' },
      kk: { title: 'Аңыз', conditionText: '10-деңгейге жетті' },
      en: { title: 'Legend', conditionText: 'Reached level 10' },
    },
  },
  {
    code: 'comeback',
    rule: { comebackTopics: 1, failedBelowPercent: 50 },
    tr: {
      ru: { title: 'Исправился', conditionText: 'Тема, которая сначала не давалась, потом взята' },
      kk: { title: 'Түзелді', conditionText: 'Алдымен қиын болған тақырып кейін меңгерілді' },
      en: { title: 'Comeback', conditionText: 'A topic that was hard at first, mastered later' },
    },
  },
  {
    code: 'bug_fixing',
    rule: { comebackTopics: 5, failedBelowPercent: 50 },
    tr: {
      ru: { title: 'Работа над ошибками', conditionText: 'Пять тем вытянуто с неудачной попытки' },
      kk: { title: 'Қатемен жұмыс', conditionText: 'Сәтсіз әрекеттен кейін бес тақырып меңгерілді' },
      en: { title: 'Learning from mistakes', conditionText: 'Five topics pulled up after a failed attempt' },
    },
  },
];

/** REQ-SUP-03: шаблоны «подтверждение, уточнение, решение, задержка». Тексты в SPEC не заданы — needs_confirmation. */
const RESPONSE_TEMPLATES: Record<string, Tr<string>> = {
  confirmation: {
    ru: 'Здравствуйте! Мы получили ваше обращение {number} и ответим на указанный email.',
    kk: 'Сәлеметсіз бе! {number} өтінішіңізді алдық және көрсетілген email-ге жауап береміз.',
    en: 'Hello! We have received your request {number} and will reply to the email you provided.',
  },
  clarification: {
    ru: 'Здравствуйте! Чтобы помочь, уточните, пожалуйста, детали по обращению {number}.',
    kk: 'Сәлеметсіз бе! Көмектесу үшін {number} өтініші бойынша мәліметтерді нақтылаңызшы.',
    en: 'Hello! To help you, please clarify the details of request {number}.',
  },
  resolution: {
    ru: 'Здравствуйте! Вопрос по обращению {number} решён. Если что-то осталось непонятным — ответьте на это письмо.',
    kk: 'Сәлеметсіз бе! {number} өтініші бойынша мәселе шешілді. Түсініксіз нәрсе қалса, осы хатқа жауап беріңіз.',
    en: 'Hello! Request {number} has been resolved. If anything is still unclear, just reply to this email.',
  },
  delay: {
    ru: 'Здравствуйте! Обработка обращения {number} занимает больше времени, чем обычно. Мы сообщим, как только будет результат.',
    kk: 'Сәлеметсіз бе! {number} өтінішін өңдеу әдеттегіден ұзағырақ уақыт алып жатыр. Нәтиже болғанда хабарлаймыз.',
    en: 'Hello! Processing request {number} is taking longer than usual. We will let you know as soon as there is a result.',
  },
};

/** Учётные записи для разработки. */
export const DEMO_IDS = {
  teacher: seedId('user:dev:teacher'),
  student: seedId('user:dev:student'),
  support: seedId('user:dev:support'),
  onboarding: seedId('user:dev:onboarding'),
};

/**
 * Коды базовой программы из content/, на которые опираются тесты и seed `visual` (BR-CNT-04). Пробный вопрос
 * (PH-02) — в квизе «Сердечно-сосудистой системы» (REQ-PUB-HOME-04: «вопрос из настоящего урока»).
 */
export const BASE_CODES = {
  sectionBiology: 'biology',
  subjectAnatomy: 'human-anatomy',
  subjectGeneralBiology: 'general-biology',
  subjectChemistry: 'chemistry',
  subjectMath: 'mathematics',
  subjectEnglish: 'english-language',
  topicCardio: 'human-anatomy/cardiovascular-system',
  topicRespiratory: 'human-anatomy/respiratory-system',
  topicDigestive: 'human-anatomy/digestive-system',
  demoQuestion: 'human-anatomy/cardiovascular-system/q/aorta',
} as const;

/** ID строк базовой программы по кодам (после импорта). */
export async function baseIds(db: Database) {
  const C = BASE_CODES;
  const subject = async (code: string) =>
    (await db.select({ id: subjects.id }).from(subjects).where(eq(subjects.code, code)))[0]!.id;
  const topic = async (code: string) =>
    (await db.select({ id: topics.id }).from(topics).where(eq(topics.code, code)))[0]!.id;
  const quiz = async (topicId: string) =>
    (await db.select({ id: quizzes.id }).from(quizzes).where(eq(quizzes.topicId, topicId)))[0]!.id;
  const [section] = await db
    .select({ id: catalogSections.id })
    .from(catalogSections)
    .where(eq(catalogSections.code, C.sectionBiology));
  const topicCardio = await topic(C.topicCardio);
  const topicRespiratory = await topic(C.topicRespiratory);
  const topicDigestive = await topic(C.topicDigestive);
  const [demo] = await db
    .select({ id: questions.id })
    .from(questions)
    .where(and(eq(questions.code, C.demoQuestion), isNotNull(questions.code)));
  return {
    sectionBiology: section!.id,
    subjectAnatomy: await subject(C.subjectAnatomy),
    subjectGeneralBiology: await subject(C.subjectGeneralBiology),
    subjectChemistry: await subject(C.subjectChemistry),
    subjectMath: await subject(C.subjectMath),
    subjectEnglish: await subject(C.subjectEnglish),
    topicCardio,
    topicRespiratory,
    topicDigestive,
    quizCardio: await quiz(topicCardio),
    quizRespiratory: await quiz(topicRespiratory),
    quizDigestive: await quiz(topicDigestive),
    demoQuestion: demo!.id,
  };
}
export type BaseIds = Awaited<ReturnType<typeof baseIds>>;

/**
 * Справочник школ для автодополнения на регистрации ученика (API-PUB-09).
 * TODO(OWNER): реальный список школ (источник и формат загрузки) — сейчас демо-данные.
 */
export const DEMO_SCHOOLS: Array<{ key: string; name: string; region: string; city: string }> = [
  { key: 'almaty-1', name: 'Школа-гимназия №1', region: 'Алматы', city: 'Алматы' },
  { key: 'almaty-25', name: 'Школа-лицей №25', region: 'Алматы', city: 'Алматы' },
  { key: 'astana-12', name: 'Средняя школа №12', region: 'Астана', city: 'Астана' },
  { key: 'shymkent-7', name: 'Гимназия №7', region: 'Шымкент', city: 'Шымкент' },
  {
    key: 'karaganda-3',
    name: 'Назарбаев Интеллектуальная школа (демо)',
    region: 'Карагандинская обл.',
    city: 'Караганда',
  },
  { key: 'talgar-2', name: 'Средняя школа №2', region: 'Алматинская обл.', city: 'Талгар' },
];
export const demoSchoolId = (key: string) => seedId(`school:demo:${key}`);

export async function seedDemo(db: Database, media: MediaStore | null = null): Promise<void> {
  assertNotProduction('demo');
  await db.transaction(async (tx) => {
    // Уровни и ранги (BR-XP-03).
    const levelRows = Array.from({ length: LEVEL_COUNT }, (_, i) => ({ level: i + 1, xpThreshold: i * 100 }));
    await tx.insert(levels).values(levelRows).onConflictDoNothing();
    await tx
      .insert(levelTranslations)
      .values(
        levelRows.flatMap(({ level }) => [
          { level, locale: 'ru' as const, title: level === 1 ? 'Новичок' : `Уровень ${level}` },
          { level, locale: 'kk' as const, title: level === 1 ? 'Жаңадан бастаушы' : `${level}-деңгей` },
          { level, locale: 'en' as const, title: level === 1 ? 'Beginner' : `Level ${level}` },
        ]),
      )
      .onConflictDoNothing();

    // Бейджи BR-BDG-01 (totalCount = 12).
    for (const [position, badge] of BADGES.entries()) {
      const badgeId = seedId(`badge:${badge.code}`);
      await tx
        .insert(badges)
        .values({ id: badgeId, code: badge.code, rule: badge.rule, position: position + 1 })
        .onConflictDoNothing();
      await tx
        .insert(badgeTranslations)
        .values(rows('badgeId', badgeId, badge.tr))
        .onConflictDoNothing();
    }

    // Шаблоны ответов поддержки (REQ-SUP-03).
    await tx
      .insert(responseTemplates)
      .values(
        Object.entries(RESPONSE_TEMPLATES).flatMap(([code, tr]) =>
          (Object.entries(tr) as Array<[keyof typeof tr, string]>).map(([locale, body]) => ({
            code,
            locale,
            body,
          })),
        ),
      )
      .onConflictDoNothing();

    // Справочник школ (API-PUB-09).
    await tx
      .insert(schools)
      .values(
        DEMO_SCHOOLS.map(({ key, ...school }) => ({ id: demoSchoolId(key), ...school, status: 'active' })),
      )
      .onConflictDoNothing();

    // Учётные записи для разработки (пароль — SEED_DEV_PASSWORD; вход появится в итерациях 4 и 6).
    const passwordHash = await hashPassword(process.env.SEED_DEV_PASSWORD ?? 'syntara-dev-password');
    const devUsers = [
      {
        id: DEMO_IDS.teacher,
        email: 'teacher@syntara.local',
        displayName: 'Demo Teacher',
        role: 'teacher' as const,
      },
      {
        id: DEMO_IDS.student,
        login: 'student',
        isChildSafe: true,
        displayName: 'Demo Student',
        role: 'student' as const,
      },
      {
        id: DEMO_IDS.support,
        email: 'support@syntara.local',
        displayName: 'Demo Support',
        role: 'support_agent' as const,
      },
      {
        id: DEMO_IDS.onboarding,
        email: 'onboarding@syntara.local',
        displayName: 'Demo Onboarding',
        role: 'onboarding_agent' as const,
      },
    ];
    for (const { role, ...user } of devUsers) {
      // Демо-аккаунты с email считаются подтверждёнными (без напоминания «Подтвердите email»).
      const emailVerifiedAt = 'email' in user ? new Date('2026-09-01T00:00:00Z') : null;
      await tx
        .insert(users)
        .values({
          ...user,
          passwordHash,
          emailVerifiedAt,
        })
        .onConflictDoUpdate({ target: users.id, set: { passwordHash, emailVerifiedAt } });
      await tx
        .insert(userRoles)
        .values({ id: seedId(`role:${user.id}:${role}`), userId: user.id, role })
        .onConflictDoNothing();
      await tx.insert(userPreferences).values({ userId: user.id }).onConflictDoNothing();
      // 5.11: профиль (имя из display_name, инициалы).
      await tx
        .insert(userProfiles)
        .values(profileFor(user.id, user.displayName, stableAvatarColor(user.id)))
        .onConflictDoNothing();
    }
  });

  // Базовая программа платформы — импорт content/ (BR-CNT-01); без хранилища картинки пропускаются.
  const { errors } = await importContent(db, { media });
  if (errors.length) throw new Error(`content/: ${errors.map(formatError).join('; ')}`);
}
