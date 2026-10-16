'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Check, X } from 'lucide-react';
import { Button, Card, cn, fieldClass, Pill, Skeleton } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';

type Attempt = components['schemas']['AttemptDto'];
type Result = components['schemas']['AnswerResultDto'];
type Finish = components['schemas']['FinishResultDto'];
type Answered = Result & { optionId: string | null; textAnswer: string | null };

const LETTERS = 'ABCDEFGH';

/**
 * Квиз ученика (8.4.4, U05, SM-ATTEMPT): маркеры прогресса, сложность, «Вопрос {i} из {n}», варианты A–D
 * (radio-группа). После выбора — сразу «Верно»/«Неверно», правильный вариант и объяснение (BR-QZ-04);
 * правильный ответ приходит только после ответа (BR-QZ-01). Незавершённая попытка продолжается с первого
 * вопроса без ответа (AC-ST-03). В конце — «Результат: {score}%», XP и бейджи, «Пройти ещё раз».
 */
export function StudentQuiz({ quizId }: { quizId: string }) {
  const t = useTranslations('student.quiz');
  const tf = useTranslations('forms');
  const locale = useLocale();
  // «Пройти ещё раз» начинает новую попытку: номер раунда — часть ключа запроса.
  const [round, setRound] = useState(0);
  const attempt = useQuery({
    queryKey: ['student', 'attempt', quizId, round],
    // API-S-07: начать или продолжить попытку (повторный вызов возвращает ту же незавершённую).
    queryFn: async () => {
      const res = await apiRequest<Attempt>(`/api/student/quizzes/${quizId}/attempts`, {
        method: 'POST',
        locale,
      });
      if (res.kind === 'ok') return { kind: 'ok' as const, attempt: res.data };
      if (res.kind === 'http' && res.status === 409) return { kind: 'empty' as const };
      throw new Error('attempt');
    },
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  if (attempt.isPending) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-3">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (attempt.data?.kind === 'empty') return <p className="text-[var(--text-muted)]">{t('empty')}</p>;
  if (!attempt.data) {
    return (
      <p role="alert" className="text-[var(--danger-text)]">
        {tf('serverError')}
      </p>
    );
  }
  return (
    <QuizRun
      key={attempt.data.attempt.attemptId}
      attempt={attempt.data.attempt}
      onRetry={() => setRound((r) => r + 1)}
    />
  );
}

/** Прохождение одной попытки: состояние инициализируется из ответа API-S-07 (AC-ST-03). */
function QuizRun({ attempt, onRetry }: { attempt: Attempt; onRetry: () => void }) {
  const t = useTranslations('student.quiz');
  const tf = useTranslations('forms');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [answered, setAnswered] = useState(attempt.answered as Record<string, Answered>);
  // Продолжаем с первого вопроса без ответа (если ответы даны на все — с последнего).
  const [index, setIndex] = useState(() => {
    const first = attempt.questions.findIndex((q) => !attempt.answered[q.id]);
    return first === -1 ? attempt.questions.length - 1 : first;
  });
  const [state, setState] = useState<'ready' | 'failed' | 'finished'>('ready');
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [finish, setFinish] = useState<Finish | null>(null);

  if (state === 'failed') {
    return (
      <p role="alert" className="text-[var(--danger-text)]">
        {tf('serverError')}
      </p>
    );
  }

  if (state === 'finished' && finish) {
    return (
      <Card className="flex flex-col items-start gap-4 p-6" data-testid="quiz-result">
        <h2 className="text-cabinet-title font-bold">
          {t('result', {
            score: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(finish.scorePercent),
          })}
        </h2>
        {finish.xpAwarded > 0 ? (
          <p className="text-lg font-semibold text-[var(--accent)]" data-testid="quiz-xp">
            {t('xp', { xp: finish.xpAwarded })}
          </p>
        ) : null}
        {finish.badgesAwarded.length ? (
          <section className="flex flex-col gap-2" data-testid="quiz-badges">
            <h3 className="font-semibold">{t('badges')}</h3>
            <ul className="flex flex-wrap gap-2">
              {finish.badgesAwarded.map((b) => (
                <li key={b.code}>
                  <Pill className="gap-2 border-[var(--warning)] py-2 text-sm">
                    <Award aria-hidden="true" className="size-4 text-[var(--warning)]" />
                    {b.title}
                  </Pill>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <Button variant="primary-white" onClick={onRetry}>
          {t('retry')}
        </Button>
      </Card>
    );
  }

  const questions = attempt.questions;
  const question = questions[index]!;
  const result = answered[question.id];
  const last = index === questions.length - 1;

  async function submit(body: { optionId?: string; textAnswer?: string }) {
    setBusy(true);
    const res = await apiRequest<Result>(`/api/student/attempts/${attempt!.attemptId}/answers`, {
      method: 'POST',
      body: { questionId: question.id, ...body },
      locale,
    });
    setBusy(false);
    if (res.kind === 'ok') {
      setAnswered((prev) => ({
        ...prev,
        [question.id]: { ...res.data, optionId: body.optionId ?? null, textAnswer: body.textAnswer ?? null },
      }));
    } else setState('failed');
  }

  async function next() {
    if (!last) {
      setIndex(index + 1);
      setText('');
      return;
    }
    setBusy(true);
    const res = await apiRequest<Finish>(`/api/student/attempts/${attempt!.attemptId}/finish`, {
      method: 'POST',
      locale,
    });
    setBusy(false);
    if (res.kind === 'ok') {
      setFinish(res.data);
      setState('finished');
      // Хедер: XP и серия (API-S-16).
      await queryClient.invalidateQueries({ queryKey: ['me', 'stats'] });
    } else setState('failed');
  }

  return (
    <section className="flex flex-col gap-5" data-testid="student-quiz">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <ol aria-label={t('progressLabel')} className="flex items-center gap-1.5">
            {questions.map((q, i) => {
              const a = answered[q.id];
              return (
                <li
                  key={q.id}
                  aria-current={i === index ? 'step' : undefined}
                  className={cn(
                    'h-2 rounded-full transition-all duration-200',
                    i === index ? 'w-6' : 'w-2',
                    a
                      ? a.correct
                        ? 'bg-[var(--success)]'
                        : 'bg-[var(--danger)]'
                      : i === index
                        ? 'bg-[var(--accent)]'
                        : 'bg-[var(--border-strong)]',
                  )}
                >
                  <span className="sr-only">
                    {i + 1}
                    {a ? ` — ${a.correct ? t('correct') : t('incorrect')}` : ''}
                  </span>
                </li>
              );
            })}
          </ol>
          <Pill data-testid="quiz-difficulty">{t(`difficulty.${question.difficulty}`)}</Pill>
        </div>
        <Pill data-testid="quiz-progress">
          {t('progress', { index: index + 1, count: questions.length })}
        </Pill>
      </div>

      <h2 className="text-cabinet-block font-semibold" id={`q-${question.id}`}>
        {question.text}
      </h2>

      {question.type === 'text_input' ? (
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim() && !result) void submit({ textAnswer: text });
          }}
        >
          <label htmlFor={`answer-${question.id}`} className="sr-only">
            {t('answerLabel')}
          </label>
          <input
            id={`answer-${question.id}`}
            value={result?.textAnswer ?? text}
            onChange={(e) => setText(e.target.value)}
            disabled={Boolean(result) || busy}
            placeholder={t('answerLabel')}
            maxLength={300}
            className={cn(fieldClass, 'sm:flex-1')}
          />
          <Button
            type="submit"
            disabled={Boolean(result) || busy || !text.trim()}
            className="sm:min-h-[var(--field-h)]"
          >
            {t('answer')}
          </Button>
        </form>
      ) : (
        <div role="radiogroup" aria-labelledby={`q-${question.id}`} className="flex flex-col gap-2">
          {question.options.map((o, i) => {
            const chosen = result?.optionId === o.id;
            const correct = result?.correctOptionId === o.id;
            return (
              <label
                key={o.id}
                data-testid="quiz-option"
                data-state={result ? (correct ? 'correct' : chosen ? 'wrong' : 'idle') : 'idle'}
                className={cn(
                  'flex min-h-12 items-center gap-3 rounded-[var(--radius-field)] border bg-[var(--surface)] px-4 py-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--accent)]',
                  result
                    ? correct
                      ? 'border-[var(--success)]'
                      : chosen
                        ? 'border-[var(--danger)]'
                        : 'border-[var(--border)]'
                    : 'cursor-pointer border-[var(--border)] hover:border-[var(--border-strong)]',
                )}
              >
                <input
                  type="radio"
                  name={`answer-${question.id}`}
                  value={o.id}
                  checked={chosen}
                  disabled={Boolean(result) || busy}
                  onChange={() => void submit({ optionId: o.id })}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)] text-xs text-[var(--text-muted)]"
                >
                  {LETTERS[i]}
                </span>
                <span className="flex-1">{o.text}</span>
                {result && correct ? (
                  <Check aria-hidden="true" className="size-4 text-[var(--success)]" />
                ) : null}
                {result && chosen && !correct ? (
                  <X aria-hidden="true" className="size-4 text-[var(--danger-text)]" />
                ) : null}
              </label>
            );
          })}
        </div>
      )}

      <div aria-live="polite" data-testid="quiz-feedback">
        {result ? (
          <Card
            className={cn(
              'flex flex-col gap-2 p-4',
              result.correct ? 'border-[var(--success)]' : 'border-[var(--danger)]',
            )}
          >
            <p
              className={cn(
                'font-semibold',
                result.correct ? 'text-[var(--success)]' : 'text-[var(--danger-text)]',
              )}
            >
              {result.correct ? t('correct') : t('incorrect')}
            </p>
            {result.correctAnswer && !result.correct ? (
              <p>{t('correctAnswer', { answer: result.correctAnswer })}</p>
            ) : null}
            {result.explanation ? <p className="text-[var(--text-muted)]">{result.explanation}</p> : null}
          </Card>
        ) : null}
      </div>

      {result ? (
        <div>
          <Button onClick={() => void next()} disabled={busy} data-testid="quiz-next">
            {t('next')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
