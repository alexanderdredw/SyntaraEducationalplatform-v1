import {
  HINT_LIMIT,
  MASTERY_THRESHOLD,
  normalizeAnswer,
  pickHintRemovals,
  scorePercent,
} from '@syntara/shared';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import type { RunMistake, RunQuestion, RunResult, RunSource } from './test-run';

type Attempt = components['schemas']['AttemptDto'];
type Result = components['schemas']['AnswerResultDto'];
type Finish = components['schemas']['FinishResultDto'];
type Hint = components['schemas']['HintResultDto'];
export type TeacherTest = components['schemas']['TeacherTestDto'];

/**
 * Единый тест темы для ученика и учителя (решение владельца 2026-10-28): одинаковый экран — вопросы по одному, после
 * ответа «верно/неверно» и правильный ответ, в конце результат. Ученик — попытка на сервере (API-S-07…09: XP, прогресс,
 * задания; «50/50» — API-S-28); учитель — `preview`: проверка в браузере по API-T-34, ничего не записывается и XP не
 * начисляются.
 */
export interface TestEngine {
  preview: boolean;
  answer(questionId: string, body: { optionId?: string; textAnswer?: string }): Promise<Result | null>;
  hint(questionId: string): Promise<Hint | null>;
  finish(correct: number): Promise<Finish | null>;
}

export function studentEngine(attemptId: string, locale: string): TestEngine {
  return {
    preview: false,
    async answer(questionId, body) {
      const res = await apiRequest<Result>(`/api/student/attempts/${attemptId}/answers`, {
        method: 'POST',
        body: { questionId, ...body },
        locale,
      });
      return res.kind === 'ok' ? res.data : null;
    },
    async hint(questionId) {
      const res = await apiRequest<Hint>(`/api/student/attempts/${attemptId}/hint`, {
        method: 'POST',
        body: { questionId },
        locale,
      });
      return res.kind === 'ok' ? res.data : null;
    },
    async finish() {
      const res = await apiRequest<Finish>(`/api/student/attempts/${attemptId}/finish`, {
        method: 'POST',
        locale,
      });
      return res.kind === 'ok' ? res.data : null;
    },
  };
}

/**
 * Учитель: правильный ответ приходит вместе с вопросом (API-T-34), ответ сравнивается как на сервере (BR-QZ-03);
 * «50/50» — в браузере, ничего не записывается (REQ-TST-04.5).
 */
export function teacherEngine(test: TeacherTest): TestEngine {
  const total = test.questions.length;
  const hinted = new Map<string, string[]>();
  return {
    preview: true,
    async answer(questionId, body) {
      const q = test.questions.find((x) => x.id === questionId);
      if (!q) return null;
      const correct =
        q.type === 'text_input'
          ? normalizeAnswer(body.textAnswer ?? '') === normalizeAnswer(q.correctAnswer ?? '')
          : body.optionId === q.correctOptionId;
      return {
        correct,
        hinted: hinted.has(questionId),
        correctOptionId: q.correctOptionId,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
      };
    },
    async hint(questionId) {
      const q = test.questions.find((x) => x.id === questionId);
      if (!q?.correctOptionId) return null;
      const removed =
        hinted.get(questionId) ??
        pickHintRemovals(
          q.options.map((o) => o.id),
          q.correctOptionId,
          (n) => Math.floor(Math.random() * n),
        );
      hinted.set(questionId, removed);
      return { questionId, removedOptionIds: removed, hintsLeft: Math.max(0, HINT_LIMIT - hinted.size) };
    },
    async finish(correct) {
      const score = scorePercent(correct, total);
      return {
        scorePercent: score,
        xpAwarded: 0,
        badgesAwarded: [],
        bestPercent: score,
        previousPercent: null,
      };
    },
  };
}

/** Тест учителя в форме попытки ученика: те же вопросы без ответов, ответов ещё нет. */
export function teacherAttempt(test: TeacherTest): Attempt {
  return {
    attemptId: 'preview',
    questions: test.questions.map(({ id, type, difficulty, text, options }) => ({
      id,
      type,
      difficulty,
      text,
      options,
    })),
    answered: {},
    hints: {},
    hintsLeft: HINT_LIMIT,
  };
}

/**
 * Источник общего движка (test-run.ts) для теста темы: все вопросы известны сразу, продолжение незавершённой попытки
 * (AC-ST-03), ошибки для экрана результата (REQ-TST-05.3) собираются из ответов. `lessonHref` — «Открыть урок →».
 */
export function topicSource(attempt: Attempt, engine: TestEngine, lessonHref: string | null): RunSource {
  const questions: RunQuestion[] = attempt.questions.map((q) => ({
    ...q,
    removed: attempt.hints[q.id] ?? [],
  }));
  const results: Record<string, RunResult> = {};
  const toResult = (
    r: Result,
    body: { optionId?: string | null; textAnswer?: string | null },
  ): RunResult => ({
    correct: r.correct,
    hinted: r.hinted,
    correctOptionId: r.correctOptionId,
    correctAnswer: r.correctAnswer,
    explanation: r.explanation,
    lessonHref,
    optionId: body.optionId ?? null,
    textAnswer: body.textAnswer ?? null,
  });
  for (const q of questions) {
    const a = attempt.answered[q.id];
    if (a) results[q.id] = toResult(a, a);
  }
  const optionText = (q: RunQuestion, id: string | null) => q.options.find((o) => o.id === id)?.text ?? '';
  return {
    preview: engine.preview,
    adaptive: false,
    async load() {
      return {
        questions,
        marks: questions.flatMap((q) =>
          results[q.id] ? [{ correct: results[q.id]!.correct, hinted: results[q.id]!.hinted }] : [],
        ),
        results: { ...results },
        total: questions.length,
        hintsLeft: attempt.hintsLeft,
      };
    },
    async answer(q, body) {
      const res = await engine.answer(q.id, body);
      if (!res) return null;
      results[q.id] = toResult(res, body);
      const i = questions.findIndex((x) => x.id === q.id);
      return { result: results[q.id]!, next: questions[i + 1] ?? null };
    },
    async hint(q) {
      const res = await engine.hint(q.id);
      if (!res) return null;
      q.removed = res.removedOptionIds;
      return { removed: res.removedOptionIds, hintsLeft: res.hintsLeft };
    },
    async finish() {
      const answered = questions.filter((q) => results[q.id]);
      const correct = answered.filter((q) => results[q.id]!.correct);
      const res = await engine.finish(correct.length);
      if (!res) return null;
      const mistakes: RunMistake[] = answered
        .filter((q) => !results[q.id]!.correct)
        .map((q) => {
          const r = results[q.id]!;
          return {
            question: q.text,
            yours: q.type === 'text_input' ? (r.textAnswer ?? '') : optionText(q, r.optionId),
            correct: q.type === 'text_input' ? (r.correctAnswer ?? '') : optionText(q, r.correctOptionId),
            explanation: r.explanation,
            href: lessonHref,
          };
        });
      return {
        correct: correct.length,
        total: questions.length,
        percent: Math.round(res.scorePercent),
        hinted: correct.filter((q) => results[q.id]!.hinted).length,
        xpAwarded: res.xpAwarded,
        bestPercent: engine.preview ? null : Math.round(res.bestPercent),
        previousPercent:
          engine.preview || res.previousPercent === null ? null : Math.round(res.previousPercent),
        badges: res.badgesAwarded,
        mastered: engine.preview ? null : res.scorePercent >= MASTERY_THRESHOLD,
        families: [],
        mistakes,
      };
    },
  };
}
