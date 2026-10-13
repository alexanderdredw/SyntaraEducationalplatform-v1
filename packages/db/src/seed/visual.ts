import { and, eq } from 'drizzle-orm';
import { type Locale } from '@syntara/shared';
import { type Database } from '../index';
import {
  answerOptions,
  answerOptionTranslations,
  assignments,
  catalogSections,
  catalogSectionTranslations,
  classes,
  classMemberships,
  classSubjectAccess,
  learningEvents,
  mediaFiles,
  questions,
  questionTranslations,
  quizAttempts,
  quizzes,
  schools,
  studentBadges,
  studentStats,
  subjects,
  subjectTranslations,
  submissions,
  topicMastery,
  topics,
  topicSections,
  topicSectionTranslations,
  topicTranslations,
  topicVersions,
  userPreferences,
  userRoles,
  users,
  xpLedger,
} from '../schema';
import { DEMO_IDS } from './demo';
import { assertNotProduction, hashPassword, rows } from './helpers';
import { seedId } from './ids';

/**
 * Seed `visual` — данные эталонов раздела 15 (AG-08: только для визуальных тестов, не константы в коде).
 * Опорная дата эталонов: 28.09.2026 (U08: период «30 дней» = 30.08.2026 — 28.09.2026).
 * Расхождения между эталонами и формулами — docs/PLAN.md, итерация 2, «Итог».
 */
export const VISUAL_NOW = new Date('2026-09-28T12:00:00+05:00');

const at = (isoLocal: string) => new Date(`${isoLocal}+05:00`);

type TopicSeed = {
  key: string;
  subjectId: string;
  position: number;
  status: 'draft' | 'published';
  tr: Partial<
    Record<
      Locale,
      { title: string; description?: string; funFact?: string; bodyMd?: string; summary?: string }
    >
  >;
};

export const VISUAL_IDS = {
  school: seedId('visual:school:73'),
  alexandr: seedId('visual:user:alexandr'),
  class9: seedId('visual:class:9'),
  class5: seedId('visual:class:5'),
  class7: seedId('visual:class:7'),
  subjectHeart: seedId('visual:subject:heart'),
  subjectBotany: seedId('visual:subject:botany'),
  subjectChemistry: seedId('visual:subject:chemistry'),
  subjectMath: seedId('visual:subject:math'),
  subjectEnglish: seedId('visual:subject:english'),
  topicHowHeartWorks: seedId('visual:topic:how-heart-works'),
  topicRespiratory: seedId('visual:topic:respiratory'),
  topicDigestive: seedId('visual:topic:digestive'),
  topicPhotosynthesis: seedId('visual:topic:photosynthesis'),
  topicPercents: seedId('visual:topic:percents'),
  topicWordOrder: seedId('visual:topic:word-order'),
};

export async function seedVisual(db: Database): Promise<void> {
  assertNotProduction('visual');
  const I = VISUAL_IDS;
  await db.transaction(async (tx) => {
    // Пользователь «Alexandr» (учитель и ученик), школа «Школа-гимназия №73».
    await tx.insert(schools).values({ id: I.school, name: 'Школа-гимназия №73' }).onConflictDoNothing();
    const passwordHash = await hashPassword(process.env.SEED_DEV_PASSWORD ?? 'syntara-dev-password');
    await tx
      .insert(users)
      .values({ id: I.alexandr, email: 'alexandr@example.com', displayName: 'Alexandr', passwordHash })
      .onConflictDoNothing();
    for (const role of ['teacher', 'student'] as const) {
      await tx
        .insert(userRoles)
        .values({ id: seedId(`visual:role:${role}`), userId: I.alexandr, role, schoolId: I.school })
        .onConflictDoNothing();
    }
    await tx.insert(userPreferences).values({ userId: I.alexandr, theme: 'dark' }).onConflictDoNothing();

    // T04: классы «9» (1 ученик), «5», «7».
    for (const [id, name] of [
      [I.class9, '9'],
      [I.class5, '5'],
      [I.class7, '7'],
    ] as const) {
      await tx
        .insert(classes)
        .values({ id, name, schoolId: I.school, teacherId: I.alexandr })
        .onConflictDoNothing();
    }
    await tx
      .insert(classMemberships)
      .values({
        id: seedId('visual:membership:9'),
        classId: I.class9,
        studentId: I.alexandr,
        joinedAt: at('2026-09-01T09:00:00'),
      })
      .onConflictDoNothing();

    // U13: разделы каталога (EN — дословно из REQ-ST-CAT-02).
    const sections: Array<[string, number, Record<Locale, { title: string; description: string }>]> = [
      [
        'biology',
        1,
        {
          ru: { title: 'Биология', description: 'Анатомия человека' },
          kk: { title: 'Биология', description: 'Адам анатомиясы' },
          en: { title: 'Biology', description: 'Human Anatomy' },
        },
      ],
      [
        'natural_sciences',
        4,
        {
          ru: { title: 'Естественные науки', description: 'Физика · География' },
          kk: { title: 'Жаратылыстану ғылымдары', description: 'Физика · География' },
          en: { title: 'Natural sciences', description: 'Physics · Geography' },
        },
      ],
      [
        'exact_sciences',
        5,
        {
          ru: { title: 'Точные науки', description: 'Математика · Алгебра · Геометрия · Информатика' },
          kk: { title: 'Нақты ғылымдар', description: 'Математика · Алгебра · Геометрия · Информатика' },
          en: { title: 'Exact sciences', description: 'Mathematics · Algebra · Geometry · Informatics' },
        },
      ],
      [
        'humanities',
        6,
        {
          ru: { title: 'Гуманитарные науки', description: 'История Казахстана' },
          kk: { title: 'Гуманитарлық ғылымдар', description: 'Қазақстан тарихы' },
          en: { title: 'Humanities', description: 'History of Kazakhstan' },
        },
      ],
      [
        'languages',
        7,
        {
          ru: { title: 'Языки', description: 'Казахский язык · Русский язык · Английский язык' },
          kk: { title: 'Тілдер', description: 'Қазақ тілі · Орыс тілі · Ағылшын тілі' },
          en: { title: 'Languages', description: 'Kazakh language · Russian language · English language' },
        },
      ],
    ];
    for (const [code, position, tr] of sections) {
      const sectionId = seedId(`section:${code}`);
      await tx.insert(catalogSections).values({ id: sectionId, code, position }).onConflictDoNothing();
      for (const r of rows('sectionId', sectionId, tr)) {
        await tx
          .insert(catalogSectionTranslations)
          .values(r)
          .onConflictDoUpdate({
            target: [catalogSectionTranslations.sectionId, catalogSectionTranslations.locale],
            set: { title: r.title, description: r.description },
          });
      }
    }

    // U03: «Анатомия человека» — «11 систем организма».
    for (const [locale, description] of [
      ['ru', '11 систем организма'],
      ['kk', 'Ағзаның 11 жүйесі'],
      ['en', '11 body systems'],
    ] as const) {
      await tx
        .update(subjectTranslations)
        .set({ description })
        .where(
          and(
            eq(subjectTranslations.subjectId, DEMO_IDS.subjectAnatomy),
            eq(subjectTranslations.locale, locale),
          ),
        );
    }

    // Предметы: T05 (учитель, флаг каталога выключен), U13 «ботаника» и «Химия», темы T10.
    const subjectSeeds: Array<{
      id: string;
      ownerId?: string;
      sectionCode?: string;
      isOfficial?: boolean;
      inPublicCatalog?: boolean;
      tr: Partial<Record<Locale, { title: string; description?: string }>>;
    }> = [
      {
        id: I.subjectHeart,
        ownerId: I.alexandr,
        tr: {
          ru: {
            title: 'Биология: сердце и кровообращение',
            description: 'Материалы урока о строении сердца и движении крови.',
          },
        },
      },
      // Пользовательское название не переводится (REQ-ST-CAT-02).
      {
        id: I.subjectBotany,
        ownerId: I.alexandr,
        tr: { ru: { title: 'ботаника', description: 'растение, животные' } },
      },
      {
        id: I.subjectChemistry,
        isOfficial: true,
        inPublicCatalog: true,
        tr: {
          ru: { title: 'Химия', description: 'Элементы, реакции, молекулярные структуры' },
          kk: { title: 'Химия', description: 'Элементтер, реакциялар, молекулалық құрылымдар' },
          en: { title: 'Chemistry', description: 'Elements, reactions, molecular structures' },
        },
      },
      {
        id: I.subjectMath,
        sectionCode: 'exact_sciences',
        isOfficial: true,
        inPublicCatalog: true,
        tr: { ru: { title: 'Математика' }, kk: { title: 'Математика' }, en: { title: 'Mathematics' } },
      },
      {
        id: I.subjectEnglish,
        sectionCode: 'languages',
        isOfficial: true,
        inPublicCatalog: true,
        tr: {
          ru: { title: 'Английский язык' },
          kk: { title: 'Ағылшын тілі' },
          en: { title: 'English language' },
        },
      },
    ];
    for (const s of subjectSeeds) {
      await tx
        .insert(subjects)
        .values({
          id: s.id,
          ownerId: s.ownerId,
          sectionId: s.sectionCode ? seedId(`section:${s.sectionCode}`) : undefined,
          isOfficial: s.isOfficial ?? false,
          inPublicCatalog: s.inPublicCatalog ?? false,
        })
        .onConflictDoNothing();
      await tx
        .insert(subjectTranslations)
        .values(rows('subjectId', s.id, s.tr))
        .onConflictDoNothing();
    }

    // U04/U09/U11/U12: тема «Сердечно-сосудистая система» — описание и разделы 01–05 (+06 в EN).
    const cardioSections: Array<{ ru?: string; en: string }> = [
      { ru: 'Основные функции', en: 'Main Functions' },
      { ru: 'Состав сердечно-сосудистой системы', en: 'Components of the Cardiovascular System' },
      { ru: 'Строение сердца', en: 'Structure of the Heart' },
      { ru: 'Круги кровообращения', en: 'Circulatory Pathways' },
      { ru: 'Кровеносные сосуды и давление', en: 'Blood Vessels and Pressure Regulation' },
      { en: 'Microcirculation' },
    ];
    for (const [locale, summary] of [
      ['ru', 'Сердце и сосуды, обеспечивающие кровообращение.'],
      ['en', 'The heart and vessels that keep blood circulating.'],
    ] as const) {
      await tx
        .update(topicTranslations)
        .set({ summary })
        .where(
          and(eq(topicTranslations.topicId, DEMO_IDS.topicCardio), eq(topicTranslations.locale, locale)),
        );
    }
    for (const [i, section] of cardioSections.entries()) {
      const sectionId = seedId(`visual:cardio-section:${i + 1}`);
      await tx
        .insert(topicSections)
        .values({ id: sectionId, topicId: DEMO_IDS.topicCardio, position: i + 1 })
        .onConflictDoNothing();
      await tx
        .insert(topicSectionTranslations)
        .values(
          rows('sectionId', sectionId, {
            ...(section.ru ? { ru: { title: section.ru } } : {}),
            en: { title: section.en },
          }),
        )
        .onConflictDoNothing();
    }

    // Темы: T06 (черновик), следующая тема «Дыхательная система», темы слабых мест T10, «Фотосинтез» T09.
    const topicSeeds: TopicSeed[] = [
      {
        key: 'how-heart-works',
        subjectId: I.subjectHeart,
        position: 1,
        status: 'draft',
        tr: {
          ru: {
            title: 'Как работает сердце',
            description: 'Разбираем четыре камеры сердца и два круга кровообращения.',
            funFact: 'Клапаны помогают крови двигаться в одном направлении.',
            bodyMd: '## Четыре камеры сердца\n\n## Два круга кровообращения\n\n## Проверьте себя\n',
          },
        },
      },
      {
        key: 'respiratory',
        subjectId: DEMO_IDS.subjectAnatomy,
        position: 2,
        status: 'published',
        tr: {
          ru: { title: 'Дыхательная система' },
          kk: { title: 'Тыныс алу жүйесі' },
          en: { title: 'Respiratory system' },
        },
      },
      {
        key: 'digestive',
        subjectId: DEMO_IDS.subjectAnatomy,
        position: 3,
        status: 'published',
        tr: {
          ru: { title: 'Пищеварительная система' },
          kk: { title: 'Ас қорыту жүйесі' },
          en: { title: 'Digestive system' },
        },
      },
      {
        key: 'photosynthesis',
        subjectId: I.subjectBotany,
        position: 1,
        status: 'published',
        tr: { ru: { title: 'Фотосинтез' } },
      },
      {
        key: 'percents',
        subjectId: I.subjectMath,
        position: 1,
        status: 'published',
        tr: { ru: { title: 'Проценты' }, kk: { title: 'Пайыздар' }, en: { title: 'Percentages' } },
      },
      {
        key: 'word-order',
        subjectId: I.subjectEnglish,
        position: 1,
        status: 'published',
        tr: { ru: { title: 'Порядок слов' }, kk: { title: 'Сөз тәртібі' }, en: { title: 'Word order' } },
      },
    ];
    for (const t of topicSeeds) {
      const topicId = seedId(`visual:topic:${t.key}`);
      await tx
        .insert(topics)
        .values({ id: topicId, subjectId: t.subjectId, position: t.position })
        .onConflictDoNothing({ target: topics.id });
      await tx
        .insert(topicTranslations)
        .values(rows('topicId', topicId, t.tr))
        .onConflictDoNothing();
      await tx
        .insert(quizzes)
        .values({ id: seedId(`visual:quiz:${t.key}`), topicId })
        .onConflictDoNothing();
      if (t.status === 'published') {
        const versionId = seedId(`visual:topic-version:${t.key}:1`);
        await tx
          .insert(topicVersions)
          .values({
            id: versionId,
            topicId,
            versionNo: 1,
            snapshot: { translations: t.tr, sections: [] },
            createdBy: I.alexandr,
          })
          .onConflictDoNothing();
        await tx
          .update(topics)
          .set({ status: 'published', publishedVersionId: versionId, publishedAt: at('2026-09-01T09:00:00') })
          .where(eq(topics.id, topicId));
      }
    }

    // T06: три обложки в галерее учителя.
    for (const n of [1, 2, 3]) {
      await tx
        .insert(mediaFiles)
        .values({
          id: seedId(`visual:cover:${n}`),
          ownerId: I.alexandr,
          kind: 'cover',
          originalName: `cover-${n}.jpg`,
          mime: 'image/jpeg',
          sizeBytes: 120_000,
          storageKey: `visual/covers/cover-${n}.jpg`,
          scanStatus: 'clean',
        })
        .onConflictDoNothing();
    }

    // T08: вопрос квиза темы «Как работает сердце».
    const t08 = seedId('visual:question:aorta-chamber');
    await tx
      .insert(questions)
      .values({
        id: t08,
        quizId: seedId('visual:quiz:how-heart-works'),
        type: 'single_choice',
        difficulty: 'easy',
        position: 1,
      })
      .onConflictDoNothing();
    await tx
      .insert(questionTranslations)
      .values({
        questionId: t08,
        locale: 'ru',
        text: 'Какая камера сердца направляет кровь в аорту?',
        explanation: 'Левый желудочек выталкивает кровь в аорту, откуда она поступает к органам тела.',
      })
      .onConflictDoNothing();
    for (const [i, [text, isCorrect]] of (
      [
        ['Левый желудочек', true],
        ['Правое предсердие', false],
      ] as const
    ).entries()) {
      const optionId = seedId(`visual:option:aorta-chamber:${i}`);
      await tx
        .insert(answerOptions)
        .values({ id: optionId, questionId: t08, position: i + 1, isCorrect })
        .onConflictDoNothing();
      await tx
        .insert(answerOptionTranslations)
        .values({ optionId, locale: 'ru', text })
        .onConflictDoNothing();
    }

    // Выдача предметов классу 9 (видимость тем для T10 и каталога U13).
    for (const subjectId of [DEMO_IDS.subjectAnatomy, I.subjectBotany, I.subjectMath, I.subjectEnglish]) {
      await tx
        .insert(classSubjectAccess)
        .values({
          id: seedId(`visual:csa:9:${subjectId}`),
          classId: I.class9,
          subjectId,
          grantedBy: I.alexandr,
        })
        .onConflictDoNothing();
    }

    // T10: результаты Alexandr — 33 %, 43 %, 43 %, 67 %, 100 %; последняя активность 05.09.2026 (U08).
    const results: Array<[string, string, string, number]> = [
      ['cardio', DEMO_IDS.topicCardio, DEMO_IDS.quizCardio, 33.33],
      ['respiratory', I.topicRespiratory, seedId('visual:quiz:respiratory'), 42.86],
      ['digestive', I.topicDigestive, seedId('visual:quiz:digestive'), 42.86],
      ['percents', I.topicPercents, seedId('visual:quiz:percents'), 66.67],
      ['word-order', I.topicWordOrder, seedId('visual:quiz:word-order'), 100],
    ];
    for (const [day, [key, topicId, quizId, percent]] of results.entries()) {
      const finishedAt = at(`2026-09-0${day + 1}T18:00:00`);
      const attemptId = seedId(`visual:attempt:${key}`);
      const eventId = seedId(`visual:event:${key}`);
      await tx
        .insert(quizAttempts)
        .values({
          id: attemptId,
          studentId: I.alexandr,
          quizId,
          status: 'finished',
          scorePercent: String(percent),
          startedAt: finishedAt,
          finishedAt,
        })
        .onConflictDoNothing();
      await tx
        .insert(learningEvents)
        .values({
          id: eventId,
          studentId: I.alexandr,
          type: 'quiz_finished',
          topicId,
          occurredAt: finishedAt,
          idempotencyKey: `quiz_finished:${attemptId}`,
        })
        .onConflictDoNothing();
      await tx
        .insert(topicMastery)
        .values({
          studentId: I.alexandr,
          topicId,
          bestPercent: String(percent),
          attemptsCount: 1,
          masteredAt: percent >= 80 ? finishedAt : null,
        })
        .onConflictDoNothing();
    }

    // U01/U10: 20 XP, уровень 1 «Новичок», серия 1; бейджи «Первый шаг» и «Тема освоена».
    const wordOrderEvent = seedId('visual:event:word-order');
    for (const [reason, amount] of [
      ['quiz_finished', 10],
      ['quiz_high_score', 10],
    ] as const) {
      await tx
        .insert(xpLedger)
        .values({
          id: seedId(`visual:xp:${reason}`),
          studentId: I.alexandr,
          amount,
          reason,
          sourceEventId: wordOrderEvent,
        })
        .onConflictDoNothing();
    }
    await tx
      .insert(studentStats)
      .values({
        studentId: I.alexandr,
        xpTotal: 20,
        level: 1,
        streakCurrent: 1,
        streakBest: 1,
        lastActivityDate: '2026-09-05',
      })
      .onConflictDoNothing();
    for (const code of ['first_step', 'topic_mastered']) {
      await tx
        .insert(studentBadges)
        .values({
          studentId: I.alexandr,
          badgeId: seedId(`badge:${code}`),
          sourceEventId: wordOrderEvent,
          awardedAt: at('2026-09-05T18:00:00'),
        })
        .onConflictDoNothing();
    }

    // T09: выданное задание «Фотосинтез», класс «7», «Сдано: 1 · На проверку: 0 · Оценено: 1».
    const assignmentId = seedId('visual:assignment:photosynthesis');
    await tx
      .insert(assignments)
      .values({
        id: assignmentId,
        classId: I.class7,
        subjectId: I.subjectBotany,
        topicId: I.topicPhotosynthesis,
        dueAt: at('2026-10-01T18:00:00'),
        createdBy: I.alexandr,
      })
      .onConflictDoNothing();
    await tx
      .insert(submissions)
      .values({
        id: seedId('visual:submission:photosynthesis'),
        assignmentId,
        studentId: I.alexandr,
        status: 'graded',
        grade: '100',
        submittedAt: at('2026-09-20T18:00:00'),
        gradedAt: at('2026-09-20T18:00:00'),
      })
      .onConflictDoNothing();
  });
}
