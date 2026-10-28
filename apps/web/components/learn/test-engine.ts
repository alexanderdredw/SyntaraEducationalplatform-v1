import { normalizeAnswer, scorePercent } from '@syntara/shared';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';

type Attempt = components['schemas']['AttemptDto'];
type Result = components['schemas']['AnswerResultDto'];
type Finish = components['schemas']['FinishResultDto'];
export type TeacherTest = components['schemas']['TeacherTestDto'];

/**
 * Единый тест темы для ученика и учителя (решение владельца 2026-10-28): одинаковый экран — вопросы по одному, после
 * ответа «верно/неверно» и правильный ответ, в конце результат. Ученик — попытка на сервере (API-S-07…09: XP, прогресс,
 * задания); учитель — `preview`: проверка в браузере по API-T-34, ничего не записывается и XP не начисляются.
 */
export interface TestEngine {
  preview: boolean;
  answer(questionId: string, body: { optionId?: string; textAnswer?: string }): Promise<Result | null>;
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
    async finish() {
      const res = await apiRequest<Finish>(`/api/student/attempts/${attemptId}/finish`, {
        method: 'POST',
        locale,
      });
      return res.kind === 'ok' ? res.data : null;
    },
  };
}

/** Учитель: правильный ответ приходит вместе с вопросом (API-T-34), ответ сравнивается как на сервере (BR-QZ-03). */
export function teacherEngine(test: TeacherTest): TestEngine {
  const total = test.questions.length;
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
        correctOptionId: q.correctOptionId,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
      };
    },
    async finish(correct) {
      return { scorePercent: scorePercent(correct, total), xpAwarded: 0, badgesAwarded: [] };
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
  };
}
