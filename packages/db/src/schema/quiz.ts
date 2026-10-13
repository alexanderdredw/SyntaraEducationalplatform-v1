import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps, tstz } from './_common';
import { classes, users } from './users';
import { subjects, topics } from './content';
import { difficultyEnum, localeEnum, questionTypeEnum, submissionStatusEnum } from './enums';

/** 5.5 Квизы и задания. */

export const quizzes = pgTable('quizzes', {
  id: id(),
  topicId: uuid('topic_id')
    .notNull()
    .unique()
    .references(() => topics.id),
  ...timestamps,
});

export const questions = pgTable('questions', {
  id: id(),
  quizId: uuid('quiz_id')
    .notNull()
    .references(() => quizzes.id),
  type: questionTypeEnum('type').notNull(),
  difficulty: difficultyEnum('difficulty').notNull(),
  position: integer('position').notNull(),
  isDemo: boolean('is_demo').notNull().default(false),
  /** Только для type = text_input. */
  textAnswer: text('text_answer'),
  archivedAt: tstz('archived_at'),
  ...timestamps,
});

export const questionTranslations = pgTable(
  'question_translations',
  {
    questionId: uuid('question_id').references(() => questions.id),
    locale: localeEnum('locale'),
    text: text('text').notNull(),
    explanation: text('explanation'),
  },
  (t) => [
    primaryKey({ columns: [t.questionId, t.locale] }),
    check('question_tr_text_len', sql`length(${t.text}) <= 1000`),
    check('question_tr_explanation_len', sql`length(${t.explanation}) <= 2000`),
  ],
);

export const answerOptions = pgTable(
  'answer_options',
  {
    id: id(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id),
    position: integer('position').notNull(),
    isCorrect: boolean('is_correct').notNull().default(false),
    ...timestamps,
  },
  // BR-QZ-02: ровно один правильный вариант на вопрос.
  (t) => [
    uniqueIndex('ux_one_correct')
      .on(t.questionId)
      .where(sql`is_correct`),
  ],
);

export const answerOptionTranslations = pgTable(
  'answer_option_translations',
  {
    optionId: uuid('option_id').references(() => answerOptions.id),
    locale: localeEnum('locale'),
    text: text('text').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.optionId, t.locale] }),
    check('answer_option_tr_text_len', sql`length(${t.text}) <= 300`),
  ],
);

/** «Тема принадлежит предмету» проверяется в сервисе и триггером check_assignment_topic() (миграция 0002). */
export const assignments = pgTable(
  'assignments',
  {
    id: id(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id),
    dueAt: tstz('due_at').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (t) => [index('ix_assignments_class').on(t.classId, t.dueAt)],
);

export const submissions = pgTable(
  'submissions',
  {
    id: id(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id),
    studentId: uuid('student_id')
      .notNull()
      .references(() => users.id),
    status: submissionStatusEnum('status').notNull(),
    grade: numeric('grade', { precision: 5, scale: 2 }),
    submittedAt: tstz('submitted_at'),
    gradedAt: tstz('graded_at'),
    gradedBy: uuid('graded_by').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    unique('submissions_assignment_student').on(t.assignmentId, t.studentId),
    index('ix_submissions_status').on(t.assignmentId, t.status),
  ],
);
