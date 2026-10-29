'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Check, Flame, X } from 'lucide-react';
import { Button, Card, cn, fieldClass, Modal, Pill, Skeleton } from '@syntara/ui';
import { MASTERY_THRESHOLD, percentDelta, segmentState } from '@syntara/shared';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { AppLink } from '../app-link';
import { studentEngine, type TeacherTest, teacherAttempt, teacherEngine, topicSource } from './test-engine';
import {
  canHint,
  type Difficulty,
  type RunSource,
  type RunSummary,
  type TestRun,
  useTestKeys,
  useTestRun,
} from './test-run';

type Attempt = components['schemas']['AttemptDto'];

const LETTERS = 'ABCDEFGH';

/** Встраивание теста темы в урок: «Открыть урок →», «К уроку» и «× Завершить» (REQ-TST-01, REQ-TST-05, REQ-TST-06). */
export interface QuizPlacement {
  lessonHref: string | null;
  onExit: () => void;
}

/**
 * Квиз ученика (8.4.4, U05, SM-ATTEMPT; docs/TESTS_TZ.md, T1): «Ход попытки» — полоса из N делений, «Вопрос k из N»,
 * серия, сложность, «50/50»; варианты A–D (radio-группа), клавиши 1–4 / A–D и Enter. После ответа — «Верно»/«Неверно»,
 * правильный вариант, объяснение и «Открыть урок →»; дальше — «Далее» или Enter (BR-QZ-04); правильный ответ приходит
 * только после ответа (BR-QZ-01). Незавершённая попытка продолжается (AC-ST-03). В конце — диаграмма, XP, лучший
 * результат, ошибки, «Повторить ошибки», «Пройти ещё раз», «К уроку». Учитель проходит тот же тест (TeacherQuiz).
 */
export function StudentQuiz({
  quizId,
  assignmentId,
  placement,
}: {
  quizId: string;
  assignmentId?: string;
  placement: QuizPlacement;
}) {
  const t = useTranslations('student.quiz');
  const tf = useTranslations('forms');
  const locale = useLocale();
  // «Пройти ещё раз» начинает новую попытку: номер раунда — часть ключа запроса.
  const [round, setRound] = useState(0);
  const attempt = useQuery({
    queryKey: ['student', 'attempt', quizId, assignmentId ?? null, round],
    // API-S-07: начать или продолжить попытку (повторный вызов возвращает ту же незавершённую).
    queryFn: async () => {
      const res = await apiRequest<Attempt>(`/api/student/quizzes/${quizId}/attempts`, {
        method: 'POST',
        // Q-18: квиз из «Мои задания» — попытка связана с заданием (BR-ASG-03).
        body: assignmentId ? { assignmentId } : {},
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
  const data = attempt.data?.kind === 'ok' ? attempt.data.attempt : null;
  const source = useMemo(
    () => (data ? topicSource(data, studentEngine(data.attemptId, locale), placement.lessonHref) : null),
    // Источник — на попытку: смена языка перезапрашивает вопросы, ответы берутся с сервера.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  );

  if (attempt.isPending) return <QuizSkeleton label={t('loading')} />;
  if (attempt.data?.kind === 'empty') return <p className="text-[var(--text-muted)]">{t('empty')}</p>;
  if (!source) {
    return (
      <p role="alert" className="text-[var(--danger-text)]">
        {tf('serverError')}
      </p>
    );
  }
  return (
    <QuizRun
      key={data!.attemptId}
      source={source}
      placement={placement}
      // Незавершённая попытка продолжается при повторном входе (BR-QZ-06) — ответы не теряются.
      exitSaved
      onRetry={() => setRound((r) => r + 1)}
    />
  );
}

function QuizSkeleton({ label }: { label: string }) {
  return (
    // OPT-05 (О4-2а): форма и высота — как у вопроса (≈ 430 px: шапка, текст, 4 варианта, кнопка), футер не прыгает.
    <div role="status" aria-busy="true" className="flex flex-col gap-5" data-testid="quiz-skeleton">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-7 w-3/4" />
      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
      <Skeleton className="h-11 w-40" />
    </div>
  );
}

/**
 * Тест темы для учителя (решение владельца 2026-10-28): тот же экран, что у ученика, с пометкой «Предпросмотр
 * учителя: результаты не записываются»; вопросы с ответами — API-T-34, проверка и «50/50» в браузере, без XP и записи.
 */
export function TeacherQuiz({ topicId, placement }: { topicId: string; placement: QuizPlacement }) {
  const t = useTranslations('student.quiz');
  const tf = useTranslations('forms');
  const locale = useLocale();
  const [round, setRound] = useState(0);
  const test = useQuery({
    queryKey: ['teacher', 'test', topicId, locale],
    queryFn: async () => {
      const res = await apiRequest<TeacherTest>(`/api/teacher/topics/${topicId}/test`, { locale });
      if (res.kind !== 'ok') throw new Error('test');
      return res.data;
    },
    retry: false,
    refetchOnWindowFocus: false,
  });
  const source = useMemo(
    () =>
      test.data
        ? topicSource(teacherAttempt(test.data), teacherEngine(test.data), placement.lessonHref)
        : null,
    // Новый раунд — новый источник (новые подсказки и ответы).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [test.data, round],
  );
  return (
    <div className="flex flex-col gap-3" data-testid="teacher-quiz">
      <p className="text-sm text-[var(--text-muted)]" data-testid="teacher-preview-note">
        {t('teacherPreview')}
      </p>
      {test.isPending ? (
        <Skeleton className="h-40" />
      ) : !test.data || !source ? (
        <p role="alert" className="text-[var(--danger-text)]">
          {tf('serverError')}
        </p>
      ) : test.data.questions.length === 0 ? (
        <p className="text-[var(--text-muted)]">{t('empty')}</p>
      ) : (
        <QuizRun
          key={round}
          source={source}
          placement={placement}
          exitSaved={false}
          onRetry={() => setRound((r) => r + 1)}
        />
      )}
    </div>
  );
}

/** Прохождение одной попытки — общий движок (test-run.ts) в оформлении платформы. */
function QuizRun({
  source,
  placement,
  exitSaved,
  onRetry,
}: {
  source: RunSource;
  placement: QuizPlacement;
  exitSaved: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations('student.quiz');
  const tt = useTranslations('test');
  const tf = useTranslations('forms');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const run = useTestRun(source);
  const [exit, setExit] = useState(false);
  useTestKeys(run, run.phase === 'question' && !exit);

  // Хедер: XP и серия (API-S-16).
  useEffect(() => {
    if (run.phase === 'finished' && !run.preview)
      void queryClient.invalidateQueries({ queryKey: ['me', 'stats'] });
  }, [run.phase, run.preview, queryClient]);

  if (run.phase === 'failed') {
    return (
      <p role="alert" className="text-[var(--danger-text)]">
        {tf('serverError')}
      </p>
    );
  }
  if (run.phase === 'loading' || (run.phase === 'question' && !run.question))
    return <QuizSkeleton label={t('loading')} />;
  if (run.phase === 'finished' && run.summary)
    return <QuizResult summary={run.summary} preview={run.preview} placement={placement} onRetry={onRetry} />;

  const question = run.question!;
  return (
    <section className="mx-auto flex w-full max-w-[1100px] flex-col gap-4" data-testid="student-quiz">
      <div className="flex justify-end">
        <Button variant="quiet" onClick={() => setExit(true)} data-testid="quiz-exit">
          <X aria-hidden="true" className="size-4" />
          {tt('exit')}
        </Button>
      </div>
      <Modal
        open={exit}
        onOpenChange={setExit}
        title={tt('exitTitle')}
        description={exitSaved ? tt('exitSaved') : tt('exitLost')}
        closeLabel={tc('close')}
      >
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={() => setExit(false)}>
            {tt('exitCancel')}
          </Button>
          <Button onClick={placement.onExit} data-testid="quiz-exit-confirm">
            {tt('exit')}
          </Button>
        </div>
      </Modal>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <RunPanel run={run} difficulty={question.difficulty} />
        <div className="flex min-w-0 flex-col gap-5 lg:order-first">
          <QuestionBody key={question.id} run={run} />
        </div>
      </div>
    </section>
  );
}

/**
 * «Ход попытки» (REQ-TST-02, REQ-TST-06): на компьютере — колонка справа, на телефоне — компактная строка сверху.
 * Полоса из N делений: зелёное — верно, жёлто-зелёное — верно с подсказкой, красное — неверно; текущее выделено.
 */
function RunPanel({ run, difficulty }: { run: TestRun; difficulty: Difficulty }) {
  const t = useTranslations('student.quiz');
  const tt = useTranslations('test');
  const current = run.position;
  return (
    <aside
      aria-label={tt('panel')}
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 lg:flex-col lg:items-stretch lg:self-start"
      data-testid="quiz-panel"
    >
      <h3 className="hidden text-sm font-semibold text-[var(--text-muted)] lg:block">{tt('panel')}</h3>
      <ol aria-label={tt('segments')} className="flex w-full items-center gap-1" data-testid="quiz-segments">
        {Array.from({ length: run.total }, (_, i) => {
          const state = segmentState(run.marks[i], i === current);
          return (
            <li
              key={i}
              data-state={state}
              aria-current={state === 'current' ? 'step' : undefined}
              className={cn(
                'h-2 flex-1 rounded-full',
                state === 'correct' && 'bg-[var(--success)]',
                state === 'hinted' && 'bg-[var(--test-hinted)]',
                state === 'wrong' && 'bg-[var(--danger)]',
                state === 'current' && 'h-3 bg-[var(--accent)]',
                state === 'todo' && 'bg-[var(--border-strong)]',
              )}
            >
              <span className="sr-only">{tt(`segment.${state}`, { index: i + 1 })}</span>
            </li>
          );
        })}
      </ol>
      <Pill data-testid="quiz-progress" className="text-[var(--text-muted)]">
        {t('progress', { index: current + 1, count: run.total })}
      </Pill>
      {run.streak >= 2 ? (
        <Pill data-testid="quiz-streak" className="gap-1.5 border-[var(--warning)]">
          <Flame aria-hidden="true" className="size-3.5 text-[var(--warning)]" />
          {tt('streak', { count: run.streak })}
        </Pill>
      ) : null}
      <DifficultyDots difficulty={difficulty} />
      <HintButton run={run} />
    </aside>
  );
}

const DOTS: Record<Difficulty, number> = { easy: 1, medium: 2, hard: 3 };

/** REQ-TST-02.4: сложность вопроса (easy/medium/hard из quiz.yaml) — три точки и подпись. */
function DifficultyDots({ difficulty }: { difficulty: Difficulty }) {
  const t = useTranslations('student.quiz');
  const tt = useTranslations('test');
  return (
    <p className="flex items-center gap-2 text-sm" data-testid="quiz-difficulty-row">
      <span className="flex gap-1" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={cn(
              'size-2 rounded-full',
              n <= DOTS[difficulty] ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]',
            )}
          />
        ))}
      </span>
      <span className="sr-only">{tt('difficulty.label')}: </span>
      <span data-testid="quiz-difficulty" className="text-[var(--text-muted)]">
        {t(`difficulty.${difficulty}`)}
      </span>
    </p>
  );
}

/** REQ-TST-04: «50/50 · осталось N»; какие варианты убрать, решает сервер (BR-TST-01). */
function HintButton({ run }: { run: TestRun }) {
  const tt = useTranslations('test');
  const q = run.question;
  if (!q || q.type !== 'single_choice' || q.options.length < 4) return null;
  const enabled = canHint(q, run.hintsLeft, Boolean(run.result)) && !run.busy;
  return (
    <Button
      variant="secondary"
      className="lg:w-full"
      disabled={!enabled}
      aria-label={`${tt('hintLabel')}. ${tt('hintLeft', { count: run.hintsLeft })}`}
      onClick={() => void run.hint()}
      data-testid="quiz-hint"
    >
      {tt('hintLeft', { count: run.hintsLeft })}
    </Button>
  );
}

function QuestionBody({ run }: { run: TestRun }) {
  const t = useTranslations('student.quiz');
  const tt = useTranslations('test');
  const question = run.question!;
  const result = run.result;
  const [text, setText] = useState('');
  // Источник последнего действия — мышь (клик сразу отправляет ответ) или клавиатура (стрелки только выбирают).
  const pointer = useRef(false);
  const nextButton = useRef<HTMLButtonElement>(null);
  // После ответа фокус — на «Далее»: Enter переходит к следующему вопросу.
  useEffect(() => {
    if (result) nextButton.current?.focus();
  }, [result]);

  const trueFalse = question.type === 'true_false';
  return (
    <>
      <h2 className="pt-1 text-xl font-bold" id={`q-${question.id}`} data-testid="quiz-question-text">
        {question.text}
      </h2>

      {question.type === 'text_input' ? (
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim() && !result) void run.submit({ textAnswer: text });
          }}
        >
          <label htmlFor={`answer-${question.id}`} className="sr-only">
            {t('answerLabel')}
          </label>
          <input
            id={`answer-${question.id}`}
            value={result?.textAnswer ?? text}
            onChange={(e) => setText(e.target.value)}
            disabled={Boolean(result) || run.busy}
            placeholder={t('answerLabel')}
            maxLength={300}
            className={cn(
              fieldClass,
              'sm:flex-1',
              result && (result.correct ? 'border-[var(--success)]' : 'test-shake border-[var(--danger)]'),
            )}
            data-state={result ? (result.correct ? 'correct' : 'wrong') : 'idle'}
          />
          <Button
            type="submit"
            disabled={Boolean(result) || run.busy || !text.trim()}
            className="sm:min-h-[var(--field-h)]"
          >
            {t('answer')}
          </Button>
        </form>
      ) : (
        <div
          role="radiogroup"
          aria-labelledby={`q-${question.id}`}
          aria-describedby={`hint-${question.id}`}
          className={cn('grid gap-2', trueFalse && 'grid-cols-2 gap-3')}
        >
          <p id={`hint-${question.id}`} className="sr-only">
            {t('keyboardHint')}. {trueFalse ? tt('trueFalseHint') : tt('keyboardHint')}
          </p>
          {question.options.map((o, i) => {
            const chosen = result?.optionId === o.id;
            const correct = result?.correctOptionId === o.id;
            const removed = question.removed.includes(o.id);
            const state = result
              ? correct
                ? 'correct'
                : chosen
                  ? 'wrong'
                  : 'idle'
              : removed
                ? 'removed'
                : 'idle';
            return (
              <label
                key={o.id}
                data-testid="quiz-option"
                data-state={state}
                // Мышь: клик по варианту сразу отправляет ответ (решение владельца 2026-10-16).
                onPointerDown={() => {
                  pointer.current = true;
                }}
                className={cn(
                  'flex items-center gap-3 rounded-[14px] border bg-[var(--surface)] px-4 py-2 text-[15px] transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--accent)]',
                  trueFalse ? 'min-h-[72px] justify-center text-lg font-semibold' : 'min-h-[46px]',
                  state === 'correct' && 'test-glow border-[var(--success)] bg-[var(--success)]/10',
                  state === 'wrong' && 'test-shake border-[var(--danger)] bg-[var(--danger)]/10',
                  state === 'removed' && 'cursor-not-allowed border-dashed border-[var(--border)] opacity-40',
                  state === 'idle' &&
                    (result
                      ? 'border-[var(--border)] opacity-70'
                      : run.selected === o.id
                        ? 'cursor-pointer border-[var(--accent)] bg-[var(--accent)]/10'
                        : 'cursor-pointer border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--field)]'),
                )}
              >
                <input
                  type="radio"
                  name={`answer-${question.id}`}
                  value={o.id}
                  data-option-id={o.id}
                  checked={result ? chosen : run.selected === o.id}
                  disabled={Boolean(result) || run.busy || removed}
                  // Клавиатура: стрелки только перемещают выбор; Enter или пробел — ответ.
                  onChange={() => run.setSelected(o.id)}
                  onClick={() => {
                    if (pointer.current) void run.submit({ optionId: o.id });
                    pointer.current = false;
                  }}
                  onKeyDown={(e) => {
                    pointer.current = false;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void run.submit({ optionId: o.id });
                    }
                  }}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--field)] text-xs font-semibold text-[var(--text-muted)]',
                    trueFalse && 'hidden',
                  )}
                >
                  {LETTERS[i]}
                </span>
                <span className={cn(!trueFalse && 'flex-1', removed && 'line-through')}>{o.text}</span>
                {removed ? <span className="sr-only">({tt('removed')})</span> : null}
                {result && correct ? (
                  <Check aria-hidden="true" className="size-4 text-[var(--success-text)]" />
                ) : null}
                {result && chosen && !correct ? (
                  <X aria-hidden="true" className="size-4 text-[var(--danger-text)]" />
                ) : null}
              </label>
            );
          })}
        </div>
      )}

      {question.type !== 'text_input' && !result ? (
        <div>
          <Button
            variant="secondary"
            disabled={!run.selected || run.busy}
            onClick={() => run.selected && void run.submit({ optionId: run.selected })}
            data-testid="quiz-answer"
          >
            {t('answer')}
          </Button>
        </div>
      ) : null}

      <div aria-live="polite" data-testid="quiz-feedback">
        {question.removed.length && !result ? <p className="sr-only">{tt('hintUsed')}</p> : null}
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
                result.correct ? 'text-[var(--success-text)]' : 'text-[var(--danger-text)]',
              )}
            >
              {result.correct ? t('correct') : t('incorrect')}
            </p>
            {result.correctAnswer && !result.correct ? (
              <p>{t('correctAnswer', { answer: result.correctAnswer })}</p>
            ) : null}
            {result.explanation ? <p className="text-[var(--text-muted)]">{result.explanation}</p> : null}
            {result.lessonHref ? (
              <AppLink
                href={result.lessonHref}
                className="self-start text-sm font-semibold text-[var(--accent)] hover:underline"
                data-testid="quiz-open-lesson"
              >
                {tt('openLesson')}
              </AppLink>
            ) : null}
          </Card>
        ) : null}
      </div>

      {result ? (
        <div>
          <Button ref={nextButton} onClick={run.next} disabled={run.busy} data-testid="quiz-next">
            {t('next')}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** REQ-TST-05: круговая диаграмма, «+N XP», с подсказкой, сравнение с прошлым, ошибки и действия. */
function QuizResult({
  summary,
  preview,
  placement,
  onRetry,
}: {
  summary: RunSummary;
  preview: boolean;
  placement: QuizPlacement;
  onRetry: () => void;
}) {
  const t = useTranslations('student.quiz');
  const tt = useTranslations('test');
  const delta = percentDelta(summary.percent, summary.previousPercent);
  return (
    <Card className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 p-6" data-testid="quiz-result">
      <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
        <ScoreRing percent={summary.percent} label={tt('result.chart', { percent: summary.percent })} />
        <div className="flex flex-col gap-2">
          {/* Целые проценты, «N из M правильно» и порог освоения (решение владельца 2026-10-16, PH-38). */}
          <h2 className="text-cabinet-title font-bold">{t('result', { score: summary.percent })}</h2>
          <p data-testid="quiz-correct-count">
            {t('correctCount', { correct: summary.correct, total: summary.total })}
          </p>
          {summary.hinted ? (
            <p className="text-sm text-[var(--text-muted)]" data-testid="quiz-hinted">
              {tt('result.hinted', { count: summary.hinted })}
            </p>
          ) : null}
          {/* Учителю — без освоения, XP и сравнения: ничего не записывается. */}
          {preview ? null : (
            <>
              <p
                data-testid="quiz-mastery"
                className={cn(
                  'font-semibold',
                  summary.mastered ? 'text-[var(--success-text)]' : 'text-[var(--text-muted)]',
                )}
              >
                {summary.mastered ? t('masteredYes') : t('masteredNo', { threshold: MASTERY_THRESHOLD })}
              </p>
              {/* BR-XP-01: «+N XP» — фактически начисленное (повтор без улучшения — +0 XP). */}
              <p className="text-lg font-semibold text-[var(--accent)]" data-testid="quiz-xp">
                {t('xp', { xp: summary.xpAwarded })}
              </p>
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="quiz-compare">
                {summary.bestPercent !== null ? (
                  <span>{tt('result.best', { percent: summary.bestPercent })}</span>
                ) : null}
                {delta !== null ? (
                  <span
                    className={cn(
                      delta > 0 && 'text-[var(--success-text)]',
                      delta < 0 && 'text-[var(--danger-text)]',
                    )}
                  >
                    {tt('result.delta', { delta: `${delta >= 0 ? '+' : ''}${delta}` })}
                  </span>
                ) : null}
              </p>
            </>
          )}
        </div>
      </div>
      {summary.badges.length ? (
        <section className="flex flex-col gap-2" data-testid="quiz-badges">
          <h3 className="font-semibold">{t('badges')}</h3>
          <ul className="flex flex-wrap gap-2">
            {summary.badges.map((b) => (
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
      {summary.mistakes.length ? (
        <section className="flex flex-col gap-3" data-testid="quiz-mistakes">
          <h3 className="font-semibold">{tt('result.mistakes')}</h3>
          <ul className="flex flex-col gap-3">
            {summary.mistakes.map((m, i) => (
              <li key={i} className="flex flex-col gap-1 rounded-[14px] border border-[var(--border)] p-4">
                <p className="font-medium">{m.question}</p>
                <p className="text-sm text-[var(--danger-text)]">{tt('result.yours', { answer: m.yours })}</p>
                <p className="text-sm text-[var(--success-text)]">
                  {tt('result.right', { answer: m.correct })}
                </p>
                {m.explanation ? (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-[var(--text-muted)]">
                      {tt('result.explanation')}
                    </summary>
                    <p className="mt-1">{m.explanation}</p>
                  </details>
                ) : null}
                {m.href ? (
                  <AppLink
                    href={m.href}
                    className="self-start text-sm font-semibold text-[var(--accent)] hover:underline"
                  >
                    {tt('openLesson')}
                  </AppLink>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {/* REQ-TST-05.4: тест темы — «Повторить ошибки» начинает новую попытку той же темы. */}
        {summary.mistakes.length ? (
          <Button variant="primary-white" onClick={onRetry} data-testid="quiz-retry-mistakes">
            {tt('result.retryMistakes')}
          </Button>
        ) : null}
        <Button variant={summary.mistakes.length ? 'secondary' : 'primary-white'} onClick={onRetry}>
          {t('retry')}
        </Button>
        <Button variant="quiet" onClick={placement.onExit} data-testid="quiz-to-lesson">
          {tt('result.toLesson')}
        </Button>
      </div>
    </Card>
  );
}

/** Круговая диаграмма процента (REQ-TST-05.1). */
function ScoreRing({ percent, label }: { percent: number; label: string }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <svg
      viewBox="0 0 120 120"
      className="size-32 shrink-0"
      role="img"
      aria-label={label}
      data-testid="quiz-ring"
    >
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--border-strong)" strokeWidth="10" />
      <circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        stroke={percent >= 80 ? 'var(--success)' : percent >= 50 ? 'var(--warning)' : 'var(--danger)'}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${(c * percent) / 100} ${c}`}
        transform="rotate(-90 60 60)"
      />
      <text
        x="60"
        y="60"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-[var(--text)] text-[26px] font-bold"
      >
        {percent}%
      </text>
    </svg>
  );
}
