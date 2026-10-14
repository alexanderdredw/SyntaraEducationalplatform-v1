import { eq } from 'drizzle-orm';
import { type Database } from '../index';
import {
  answerOptions,
  answerOptionTranslations,
  badges,
  badgeTranslations,
  catalogSections,
  catalogSectionTranslations,
  levels,
  levelTranslations,
  questions,
  questionTranslations,
  quizzes,
  responseTemplates,
  subjects,
  subjectTranslations,
  topics,
  topicTranslations,
  topicVersions,
  userPreferences,
  userRoles,
  schools,
  users,
} from '../schema';
import {
  ANATOMY_TOPICS,
  CARDIO_EXTRA_QUESTIONS,
  type DemoQuestion,
  GENERAL_BIOLOGY_TOPICS,
  type Tri,
} from './demo-content';
import { seedId } from './ids';
import { assertNotProduction, hashPassword, rows, type Tr } from './helpers';

/**
 * Seed `demo`: справочники и минимальный набор для разработки.
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

/** PH-01: публичные предметы; описания — REQ-PUB-HOME-06. */
const PUBLIC_SECTIONS: Array<{
  code: string;
  position: number;
  tr: Tr<{ title: string; description: string }>;
}> = [
  {
    code: 'biology',
    position: 1,
    tr: {
      ru: { title: 'Биология', description: 'Раздел: анатомия человека — и скоро больше' },
      kk: { title: 'Биология', description: 'Бөлім: адам анатомиясы — жақында тағы да көбірек' },
      en: { title: 'Biology', description: 'Section: human anatomy — and more soon' },
    },
  },
  {
    code: 'chemistry',
    position: 2,
    tr: {
      ru: { title: 'Химия', description: 'Элементы, реакции, молекулярные структуры' },
      kk: { title: 'Химия', description: 'Элементтер, реакциялар, молекулалық құрылымдар' },
      en: { title: 'Chemistry', description: 'Elements, reactions, molecular structures' },
    },
  },
  {
    code: 'physics',
    position: 3,
    tr: {
      ru: { title: 'Физика', description: 'Механика, волны, термодинамика' },
      kk: { title: 'Физика', description: 'Механика, толқындар, термодинамика' },
      en: { title: 'Physics', description: 'Mechanics, waves, thermodynamics' },
    },
  },
];

/** PH-02: пробный вопрос из настоящего урока (is_demo = true, BR-QZ-09). */
const DEMO_QUESTION = {
  tr: {
    ru: {
      text: 'Какой сосуд несёт кровь от сердца к телу?',
      explanation: 'Аорта — главная артерия: по ней кровь из левого желудочка идёт ко всем органам тела.',
    },
    kk: {
      text: 'Қай қан тамыры қанды жүректен денеге тасымалдайды?',
      explanation:
        'Қолқа — басты артерия: ол арқылы қан сол жақ қарыншадан дененің барлық мүшелеріне барады.',
    },
    en: {
      text: 'Which vessel carries blood from the heart to the body?',
      explanation:
        'The aorta is the main artery: blood flows through it from the left ventricle to all organs of the body.',
    },
  } satisfies Tr<{ text: string; explanation: string }>,
  options: [
    { ru: 'Аорта', kk: 'Қолқа', en: 'Aorta' },
    { ru: 'Полая вена', kk: 'Қуыс вена', en: 'Vena cava' },
    { ru: 'Капилляр', kk: 'Капилляр', en: 'Capillary' },
    { ru: 'Лимфатический сосуд', kk: 'Лимфа тамыры', en: 'Lymphatic vessel' },
  ] satisfies Tr<string>[],
  correct: 0,
};

/** Официальный предмет и тема, в которых живёт пробный вопрос (REQ-PUB-HOME-04: «вопрос из настоящего урока»). */
export const DEMO_IDS = {
  sectionBiology: seedId('section:biology'),
  subjectAnatomy: seedId('subject:anatomy'),
  topicCardio: seedId('topic:anatomy:cardiovascular'),
  topicCardioVersion: seedId('topic-version:anatomy:cardiovascular:1'),
  quizCardio: seedId('quiz:anatomy:cardiovascular'),
  demoQuestion: seedId('question:demo:aorta'),
  teacher: seedId('user:dev:teacher'),
  student: seedId('user:dev:student'),
  support: seedId('user:dev:support'),
  onboarding: seedId('user:dev:onboarding'),
  subjectGeneralBiology: seedId('subject:general-biology'),
};

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

export const anatomyTopicId = (key: string) => seedId(`topic:anatomy:${key}`);
export const anatomyQuizId = (key: string) => seedId(`quiz:anatomy:${key}`);
export const generalBiologyTopicId = (n: number) => seedId(`topic:general-biology:${n}`);

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
const tri = <T extends string>(t: Tri, wrap: (v: string) => Record<T, string>) => ({
  ru: wrap(t[0]),
  kk: wrap(t[1]),
  en: wrap(t[2]),
});

/** Опубликованная тема с версией 1 и пустым квизом (идемпотентно). */
async function publishedTopic(
  tx: Tx,
  t: { id: string; subjectId: string; position: number; title: Tri; quizId?: string },
): Promise<void> {
  const tr = tri(t.title, (title) => ({ title }));
  const versionId = seedId(`topic-version:${t.id}:1`);
  await tx
    .insert(topics)
    .values({ id: t.id, subjectId: t.subjectId, position: t.position })
    .onConflictDoNothing({ target: topics.id });
  await tx
    .insert(topicTranslations)
    .values(rows('topicId', t.id, tr))
    .onConflictDoNothing();
  await tx
    .insert(topicVersions)
    .values({
      id: versionId,
      topicId: t.id,
      versionNo: 1,
      snapshot: { translations: tr, sections: [] },
      createdBy: DEMO_IDS.teacher,
    })
    .onConflictDoNothing();
  await tx
    .update(topics)
    .set({
      status: 'published',
      publishedVersionId: versionId,
      publishedAt: new Date('2026-09-01T00:00:00Z'),
    })
    .where(eq(topics.id, t.id));
  if (t.quizId) await tx.insert(quizzes).values({ id: t.quizId, topicId: t.id }).onConflictDoNothing();
}

/** Вопрос «Выбор варианта» с переводами и вариантами (идемпотентно). */
async function demoQuestion(
  tx: Tx,
  quizId: string,
  key: string,
  position: number,
  dq: DemoQuestion,
): Promise<void> {
  const questionId = seedId(`question:${key}`);
  await tx
    .insert(questions)
    .values({ id: questionId, quizId, type: 'single_choice', difficulty: dq.difficulty, position })
    .onConflictDoNothing();
  await tx
    .insert(questionTranslations)
    .values(
      (['ru', 'kk', 'en'] as const).map((locale, i) => ({
        questionId,
        locale,
        text: dq.text[i]!,
        explanation: dq.explanation[i]!,
      })),
    )
    .onConflictDoNothing();
  for (const [o, option] of dq.options.entries()) {
    const optionId = seedId(`option:${key}:${o}`);
    await tx
      .insert(answerOptions)
      .values({ id: optionId, questionId, position: o + 1, isCorrect: o === dq.correct })
      .onConflictDoNothing();
    await tx
      .insert(answerOptionTranslations)
      .values((['ru', 'kk', 'en'] as const).map((locale, i) => ({ optionId, locale, text: option[i]! })))
      .onConflictDoNothing();
  }
}

const CARDIO_TOPIC_TR: Tr<{ title: string }> = {
  ru: { title: 'Сердечно-сосудистая система' },
  kk: { title: 'Жүрек-қантамыр жүйесі' },
  en: { title: 'Cardiovascular system' },
};

export async function seedDemo(db: Database): Promise<void> {
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

    // Публичные разделы каталога (PH-01).
    for (const section of PUBLIC_SECTIONS) {
      const sectionId = seedId(`section:${section.code}`);
      await tx
        .insert(catalogSections)
        .values({ id: sectionId, code: section.code, position: section.position })
        .onConflictDoNothing();
      await tx
        .insert(catalogSectionTranslations)
        .values(rows('sectionId', sectionId, section.tr))
        .onConflictDoNothing();
    }

    // Официальный предмет, тема и квиз с пробным вопросом (PH-02).
    await tx
      .insert(subjects)
      .values({
        id: DEMO_IDS.subjectAnatomy,
        sectionId: DEMO_IDS.sectionBiology,
        isOfficial: true,
        inPublicCatalog: true,
      })
      .onConflictDoNothing();
    await tx
      .insert(subjectTranslations)
      .values(
        rows('subjectId', DEMO_IDS.subjectAnatomy, {
          ru: { title: 'Анатомия человека' },
          kk: { title: 'Адам анатомиясы' },
          en: { title: 'Human Anatomy' },
        }),
      )
      .onConflictDoNothing();

    await tx
      .insert(users)
      .values({ id: DEMO_IDS.teacher, email: 'teacher@syntara.local', displayName: 'Demo Teacher' })
      .onConflictDoNothing();
    await tx
      .insert(topics)
      .values({ id: DEMO_IDS.topicCardio, subjectId: DEMO_IDS.subjectAnatomy, position: 1 })
      .onConflictDoNothing({ target: topics.id });
    await tx
      .insert(topicTranslations)
      .values(rows('topicId', DEMO_IDS.topicCardio, CARDIO_TOPIC_TR))
      .onConflictDoNothing();
    await tx
      .insert(topicVersions)
      .values({
        id: DEMO_IDS.topicCardioVersion,
        topicId: DEMO_IDS.topicCardio,
        versionNo: 1,
        snapshot: { translations: CARDIO_TOPIC_TR, sections: [] },
        createdBy: DEMO_IDS.teacher,
      })
      .onConflictDoNothing();
    await tx
      .update(topics)
      .set({
        status: 'published',
        publishedVersionId: DEMO_IDS.topicCardioVersion,
        publishedAt: new Date('2026-09-01T00:00:00Z'),
      })
      .where(eq(topics.id, DEMO_IDS.topicCardio));
    await tx
      .insert(quizzes)
      .values({ id: DEMO_IDS.quizCardio, topicId: DEMO_IDS.topicCardio })
      .onConflictDoNothing();
    await tx
      .insert(questions)
      .values({
        id: DEMO_IDS.demoQuestion,
        quizId: DEMO_IDS.quizCardio,
        type: 'single_choice',
        difficulty: 'medium',
        position: 1,
        isDemo: true,
      })
      .onConflictDoNothing();
    await tx
      .insert(questionTranslations)
      .values(rows('questionId', DEMO_IDS.demoQuestion, DEMO_QUESTION.tr))
      .onConflictDoNothing();
    for (const [i, option] of DEMO_QUESTION.options.entries()) {
      const optionId = seedId(`option:demo:aorta:${i}`);
      await tx
        .insert(answerOptions)
        .values({
          id: optionId,
          questionId: DEMO_IDS.demoQuestion,
          position: i + 1,
          isCorrect: i === DEMO_QUESTION.correct,
        })
        .onConflictDoNothing();
      await tx
        .insert(answerOptionTranslations)
        .values(
          (Object.entries(option) as Array<['ru' | 'kk' | 'en', string]>).map(([locale, text]) => ({
            optionId,
            locale,
            text,
          })),
        )
        .onConflictDoNothing();
    }

    // Демо-контент (решение владельца): ещё 8 вопросов темы «Сердечно-сосудистая система» (всего 9),
    // остальные 10 систем «Анатомии человека» (по 3 вопроса) и предмет «Общая биология» (28 тем).
    for (const [i, dq] of CARDIO_EXTRA_QUESTIONS.entries()) {
      await demoQuestion(tx, DEMO_IDS.quizCardio, `anatomy:cardiovascular:${i + 2}`, i + 2, dq);
    }
    for (const [i, topic] of ANATOMY_TOPICS.entries()) {
      const quizId = anatomyQuizId(topic.key);
      await publishedTopic(tx, {
        id: anatomyTopicId(topic.key),
        subjectId: DEMO_IDS.subjectAnatomy,
        position: i + 2,
        title: topic.title,
        quizId,
      });
      for (const [n, dq] of topic.questions.entries()) {
        await demoQuestion(tx, quizId, `anatomy:${topic.key}:${n + 1}`, n + 1, dq);
      }
    }
    await tx
      .insert(subjects)
      .values({
        id: DEMO_IDS.subjectGeneralBiology,
        sectionId: DEMO_IDS.sectionBiology,
        isOfficial: true,
        inPublicCatalog: true,
      })
      .onConflictDoNothing();
    await tx
      .insert(subjectTranslations)
      .values(
        rows(
          'subjectId',
          DEMO_IDS.subjectGeneralBiology,
          tri(['Общая биология', 'Жалпы биология', 'General biology'], (title) => ({ title })),
        ),
      )
      .onConflictDoNothing();
    for (const [i, title] of GENERAL_BIOLOGY_TOPICS.entries()) {
      await publishedTopic(tx, {
        id: generalBiologyTopicId(i + 1),
        subjectId: DEMO_IDS.subjectGeneralBiology,
        position: i + 1,
        title,
      });
    }

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
    }
  });
}
