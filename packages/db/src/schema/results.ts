import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps, tstz } from './_common';
import { users } from './users';
import { mediaFiles, subjects, topics, topicVersions } from './content';
import { answerOptions, assignments, questions, quizzes } from './quiz';
import { attemptStatusEnum, localeEnum } from './enums';

/** 5.6 Результаты и геймификация. */

export const quizAttempts = pgTable(
  'quiz_attempts',
  {
    id: id(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => users.id),
    quizId: uuid('quiz_id')
      .notNull()
      .references(() => quizzes.id),
    topicVersionId: uuid('topic_version_id').references(() => topicVersions.id),
    assignmentId: uuid('assignment_id').references(() => assignments.id),
    status: attemptStatusEnum('status').notNull().default('in_progress'),
    scorePercent: numeric('score_percent', { precision: 5, scale: 2 }),
    /** BR-TST-01 (docs/TESTS_TZ.md): процент для XP — верный с подсказкой «50/50» весит 0,5; до 0017 — null. */
    xpPercent: numeric('xp_percent', { precision: 5, scale: 2 }),
    startedAt: tstz('started_at').notNull().defaultNow(),
    finishedAt: tstz('finished_at'),
    ...timestamps,
  },
  (t) => [index('ix_attempts_student').on(t.studentId, t.finishedAt), index('ix_attempts_quiz').on(t.quizId)],
);

export const attemptAnswers = pgTable(
  'attempt_answers',
  {
    attemptId: uuid('attempt_id').references(() => quizAttempts.id),
    questionId: uuid('question_id').references(() => questions.id),
    optionId: uuid('option_id').references(() => answerOptions.id),
    textAnswer: text('text_answer'),
    isCorrect: boolean('is_correct').notNull(),
    answeredAt: tstz('answered_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.attemptId, t.questionId] })],
);

/**
 * REQ-TST-04, BR-TST-01 (docs/TESTS_TZ.md): подсказка «50/50» к вопросу попытки — какие варианты убрал сервер. Не
 * больше одной на вопрос (PK) и трёх на попытку (сервис). Верный ответ на вопрос с подсказкой весит для XP 0,5.
 */
export const attemptHints = pgTable(
  'attempt_hints',
  {
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => quizAttempts.id),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id),
    removedOptionIds: uuid('removed_option_ids').array().notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.attemptId, t.questionId] }),
    check('attempt_hints_removed', sql`cardinality(${t.removedOptionIds}) = 2`),
  ],
);

export const learningEvents = pgTable(
  'learning_events',
  {
    id: id(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => users.id),
    type: text('type').notNull(),
    subjectId: uuid('subject_id').references(() => subjects.id),
    topicId: uuid('topic_id').references(() => topics.id),
    occurredAt: tstz('occurred_at').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    ...timestamps,
  },
  (t) => [
    check(
      'learning_events_type',
      sql`${t.type} IN ('lesson_opened','quiz_finished','topic_mastered','ai_question','atlas_quiz_finished')`,
    ),
    unique('learning_events_student_idem').on(t.studentId, t.idempotencyKey),
    index('ix_events_student_time').on(t.studentId, t.occurredAt),
  ],
);

export const topicMastery = pgTable(
  'topic_mastery',
  {
    studentId: uuid('student_id').references(() => users.id),
    topicId: uuid('topic_id').references(() => topics.id),
    bestPercent: numeric('best_percent', { precision: 5, scale: 2 }).notNull(),
    attemptsCount: integer('attempts_count').notNull(),
    masteredAt: tstz('mastered_at'),
  },
  (t) => [primaryKey({ columns: [t.studentId, t.topicId] }), index('ix_mastery_topic').on(t.topicId)],
);

export const studentStats = pgTable('student_stats', {
  studentId: uuid('student_id')
    .primaryKey()
    .references(() => users.id),
  xpTotal: integer('xp_total').notNull().default(0),
  level: integer('level').notNull().default(1),
  streakCurrent: integer('streak_current').notNull().default(0),
  streakBest: integer('streak_best').notNull().default(0),
  lastActivityDate: date('last_activity_date'),
  ...timestamps,
});

export const levels = pgTable('levels', {
  level: integer('level').primaryKey(),
  xpThreshold: integer('xp_threshold').notNull().unique(),
  ...timestamps,
});

export const levelTranslations = pgTable(
  'level_translations',
  {
    level: integer('level').references(() => levels.level),
    locale: localeEnum('locale'),
    title: text('title').notNull(),
  },
  (t) => [primaryKey({ columns: [t.level, t.locale] })],
);

export const badges = pgTable('badges', {
  id: id(),
  code: text('code').notNull().unique(),
  imageMediaId: uuid('image_media_id').references(() => mediaFiles.id),
  rule: jsonb('rule').notNull(),
  position: integer('position').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});

export const badgeTranslations = pgTable(
  'badge_translations',
  {
    badgeId: uuid('badge_id').references(() => badges.id),
    locale: localeEnum('locale'),
    title: text('title').notNull(),
    conditionText: text('condition_text').notNull(),
  },
  (t) => [primaryKey({ columns: [t.badgeId, t.locale] })],
);

export const studentBadges = pgTable(
  'student_badges',
  {
    studentId: uuid('student_id').references(() => users.id),
    badgeId: uuid('badge_id').references(() => badges.id),
    awardedAt: tstz('awarded_at').notNull().defaultNow(),
    sourceEventId: uuid('source_event_id').references(() => learningEvents.id),
  },
  (t) => [primaryKey({ columns: [t.studentId, t.badgeId] })],
);

export const xpLedger = pgTable(
  'xp_ledger',
  {
    id: id(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => users.id),
    amount: integer('amount').notNull(),
    reason: text('reason').notNull(),
    sourceEventId: uuid('source_event_id')
      .notNull()
      .references(() => learningEvents.id),
    ...timestamps,
  },
  // BR-XP-02: повторная обработка события не начисляет XP повторно.
  (t) => [unique('xp_ledger_student_event_reason').on(t.studentId, t.sourceEventId, t.reason)],
);

/**
 * Квиз «Проверь знания» и игра «Кто этот учёный?» модуля «Mendeleev Atlas» (REQ-ATL-03, решения А-5, А-11):
 * вопросы строит и проверяет сервер — правильный вариант не уходит в браузер до ответа (BR-QZ-01). В `state` —
 * очередь элементов или учёных, адаптивная сложность, текущий вопрос и ответы; XP — при завершении (BR-XP-05).
 */
export const atlasQuizSessions = pgTable(
  'atlas_quiz_sessions',
  {
    id: id(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => users.id),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('in_progress'),
    state: jsonb('state').notNull(),
    correctCount: integer('correct_count').notNull().default(0),
    total: integer('total').notNull(),
    xpAwarded: integer('xp_awarded').notNull().default(0),
    finishedAt: tstz('finished_at'),
    ...timestamps,
  },
  (t) => [
    check('atlas_quiz_kind', sql`${t.kind} IN ('elements','scientists')`),
    check('atlas_quiz_status', sql`${t.status} IN ('in_progress','finished')`),
    check('atlas_quiz_counts', sql`${t.correctCount} BETWEEN 0 AND ${t.total} AND ${t.xpAwarded} >= 0`),
    index('ix_atlas_quiz_student_time').on(t.studentId, t.createdAt),
  ],
);
