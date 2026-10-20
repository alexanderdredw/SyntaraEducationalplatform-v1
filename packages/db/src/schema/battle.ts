import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { type BattleSettings } from '@syntara/shared';
import { id, timestamps, tstz } from './_common';
import { classes, users } from './users';
import { mediaFiles } from './content';
import { questions } from './quiz';
import { battlePhaseEnum, battleSessionStatusEnum, localeEnum, questionTypeEnum } from './enums';

/** 5.9 Battle (итерация 10.5). Правила — SPEC 7.12, автомат — SM-BTL. */

export const battleQuizzes = pgTable(
  'battle_quizzes',
  {
    id: id(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    description: text('description'),
    /** Язык содержания теста; перевода нет (BR-BTL-10). */
    locale: localeEnum('locale').notNull(),
    archivedAt: tstz('archived_at'),
    ...timestamps,
  },
  (t) => [
    check('battle_quizzes_title_len', sql`length(${t.title}) BETWEEN 1 AND 120`),
    check('battle_quizzes_description_len', sql`length(${t.description}) <= 500`),
    index('ix_battle_quizzes_owner').on(t.ownerId, t.createdAt.desc()),
  ],
);

// UNIQUE (battle_quiz_id, position) DEFERRABLE INITIALLY DEFERRED — в миграции 0007 (перестановка в одной транзакции).
export const battleQuestions = pgTable(
  'battle_questions',
  {
    id: id(),
    battleQuizId: uuid('battle_quiz_id')
      .notNull()
      .references(() => battleQuizzes.id),
    position: integer('position').notNull(),
    type: questionTypeEnum('type').notNull(),
    text: text('text').notNull(),
    /** Файл галереи учителя (media_files kind = 'cover', BR-BTL-10). */
    imageMediaId: uuid('image_media_id').references(() => mediaFiles.id),
    timeLimitSec: integer('time_limit_sec').notNull().default(20),
    /** Исходный вопрос квиза темы, если вопрос импортирован (копия, BR-BTL-10). */
    sourceQuestionId: uuid('source_question_id').references(() => questions.id),
    archivedAt: tstz('archived_at'),
    ...timestamps,
  },
  (t) => [
    check('battle_questions_type', sql`${t.type} IN ('single_choice', 'true_false')`),
    check('battle_questions_text_len', sql`length(${t.text}) BETWEEN 1 AND 300`),
    check('battle_questions_time_limit', sql`${t.timeLimitSec} IN (5, 10, 20, 30, 60, 90)`),
  ],
);

export const battleOptions = pgTable(
  'battle_options',
  {
    id: id(),
    battleQuestionId: uuid('battle_question_id')
      .notNull()
      .references(() => battleQuestions.id),
    position: integer('position').notNull(),
    text: text('text').notNull(),
    isCorrect: boolean('is_correct').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    unique('battle_options_question_position').on(t.battleQuestionId, t.position),
    check('battle_options_position', sql`${t.position} BETWEEN 1 AND 4`),
    check('battle_options_text_len', sql`length(${t.text}) BETWEEN 1 AND 150`),
    // BR-BTL-10: ровно один правильный вариант на вопрос.
    uniqueIndex('ux_battle_one_correct')
      .on(t.battleQuestionId)
      .where(sql`is_correct`),
  ],
);

/** Снимок вопросов при запуске сессии (BR-BTL-05); правильные варианты не отдаются ученику до reveal. */
export interface BattleSnapshotQuestion {
  index: number;
  type: 'single_choice' | 'true_false';
  text: string;
  imageMediaId: string | null;
  timeLimitSec: number;
  options: Array<{ position: number; text: string; isCorrect: boolean }>;
}

export const battleSessions = pgTable(
  'battle_sessions',
  {
    id: id(),
    battleQuizId: uuid('battle_quiz_id')
      .notNull()
      .references(() => battleQuizzes.id),
    hostId: uuid('host_id')
      .notNull()
      .references(() => users.id),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id),
    code: char('code', { length: 6 }).notNull(),
    status: battleSessionStatusEnum('status').notNull().default('lobby'),
    phase: battlePhaseEnum('phase').notNull().default('lobby'),
    settings: jsonb('settings').$type<BattleSettings>().notNull(),
    questionsSnapshot: jsonb('questions_snapshot').$type<BattleSnapshotQuestion[]>().notNull(),
    currentIndex: integer('current_index'),
    questionStartedAt: tstz('question_started_at'),
    deadlineAt: tstz('deadline_at'),
    stateVersion: integer('state_version').notNull().default(0),
    cancelReason: text('cancel_reason'),
    startedAt: tstz('started_at'),
    finishedAt: tstz('finished_at'),
    lastActivityAt: tstz('last_activity_at').notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    check('battle_sessions_code', sql`${t.code} ~ '^[A-Z]{3}[1-9]{3}$'`),
    check('battle_sessions_cancel_reason', sql`${t.cancelReason} IN ('host', 'expired')`),
    // BR-BTL-01: код уникален среди активных сессий.
    uniqueIndex('ux_battle_active_code')
      .on(t.code)
      .where(sql`status IN ('lobby', 'in_progress')`),
    index('ix_battle_sessions_host').on(t.hostId, t.createdAt.desc()),
    index('ix_battle_sessions_class').on(t.classId, t.createdAt.desc()),
  ],
);

export const battleParticipants = pgTable(
  'battle_participants',
  {
    id: id(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => battleSessions.id),
    studentId: uuid('student_id')
      .notNull()
      .references(() => users.id),
    displayName: text('display_name').notNull(),
    joinedAt: tstz('joined_at').notNull().defaultNow(),
    leftAt: tstz('left_at'),
    kickedAt: tstz('kicked_at'),
    lastSeenAt: tstz('last_seen_at').notNull().defaultNow(),
    /** Итоги — при переходе в finished (BR-BTL-04). */
    correctCount: integer('correct_count'),
    answeredCount: integer('answered_count'),
    correctTimeMs: integer('correct_time_ms'),
    finalRank: integer('final_rank'),
    ...timestamps,
  },
  (t) => [
    unique('battle_participants_session_student').on(t.sessionId, t.studentId),
    check('battle_participants_name_len', sql`length(${t.displayName}) <= 80`),
  ],
);

export const battleAnswers = pgTable(
  'battle_answers',
  {
    id: id(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => battleSessions.id),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => battleParticipants.id),
    questionIndex: integer('question_index').notNull(),
    optionPosition: integer('option_position').notNull(),
    isCorrect: boolean('is_correct').notNull(),
    responseMs: integer('response_ms').notNull(),
    answeredAt: tstz('answered_at').notNull(),
    clientAnswerId: uuid('client_answer_id').notNull(),
    ...timestamps,
  },
  (t) => [
    unique('battle_answers_participant_question').on(t.participantId, t.questionIndex),
    unique('battle_answers_participant_client').on(t.participantId, t.clientAnswerId),
    check('battle_answers_question_index', sql`${t.questionIndex} >= 0`),
    check('battle_answers_option_position', sql`${t.optionPosition} BETWEEN 1 AND 4`),
    check('battle_answers_response_ms', sql`${t.responseMs} >= 0`),
    index('ix_battle_answers_question').on(t.sessionId, t.questionIndex),
  ],
);
