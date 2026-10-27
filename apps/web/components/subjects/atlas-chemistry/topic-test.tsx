'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MASTERY_THRESHOLD } from '@syntara/shared';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { useAtlasSubject } from './atlas-data';
import { GuestInvite, PreviewNote, useAtlasViewer } from './gate';

type Attempt = components['schemas']['AttemptDto'];
type Result = components['schemas']['AnswerResultDto'];
type Finish = components['schemas']['FinishResultDto'];
type Preview = components['schemas']['AtlasPreviewDto'];

/** Автопереход к следующему вопросу — как в помощнике атласа (LearningAssistant.js). */
const NEXT_MS = 1500;

/**
 * Тест темы в стиле режима «Тест» помощника атласа (решения 4, А-3, А-5): «Вопрос 1 / 5», «Счёт», варианты-кнопки,
 * «Верно! / Неверно.», автопереход, итог «Тест завершен!». Движок — квиз платформы: попытки, XP (BR-XP-01),
 * прогресс и освоение (BR-QZ-06/07), задание учителя (assignmentId, Q-18); правильный ответ приходит только после
 * ответа (BR-QZ-01). Гостю — вход; учителю — вопросы без ответов (А-9).
 */
export function TopicTest({
  topicId,
  quizId,
  assignmentId,
}: {
  topicId: string;
  quizId: string | null;
  assignmentId?: string;
}) {
  const viewer = useAtlasViewer();
  if (viewer === 'guest') return <GuestInvite />;
  if (viewer === 'teacher') return <TeacherPreview topicId={topicId} />;
  return quizId ? <StudentTest quizId={quizId} assignmentId={assignmentId} /> : null;
}

function StudentTest({ quizId, assignmentId }: { quizId: string; assignmentId?: string }) {
  const tf = useTranslations('forms');
  const tq = useTranslations('student.quiz');
  const locale = useLocale();
  const [round, setRound] = useState(0);
  const attempt = useQuery({
    queryKey: ['student', 'attempt', quizId, assignmentId ?? null, round],
    queryFn: async () => {
      const res = await apiRequest<Attempt>(`/api/student/quizzes/${quizId}/attempts`, {
        method: 'POST',
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
  if (attempt.isPending)
    return (
      <div className="typing-indicator" role="status" aria-label={tq('loading')}>
        <span />
        <span />
        <span />
      </div>
    );
  if (attempt.data?.kind === 'empty') return <p className="ai-placeholder">{tq('empty')}</p>;
  if (!attempt.data)
    return (
      <p role="alert" className="ai-placeholder">
        {tf('serverError')}
      </p>
    );
  return (
    <Run
      key={attempt.data.attempt.attemptId}
      attempt={attempt.data.attempt}
      onRetry={() => setRound((r) => r + 1)}
    />
  );
}

function Run({ attempt, onRetry }: { attempt: Attempt; onRetry: () => void }) {
  const t = useTranslations('atlas.assistant');
  const tq = useTranslations('student.quiz');
  const tf = useTranslations('forms');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const questions = attempt.questions;
  const [answered, setAnswered] = useState(
    attempt.answered as Record<string, Result & { optionId: string | null }>,
  );
  const [index, setIndex] = useState(() => {
    const first = questions.findIndex((q) => !attempt.answered[q.id]);
    return first === -1 ? questions.length - 1 : first;
  });
  const [finish, setFinish] = useState<Finish | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const score = questions.filter((q) => answered[q.id]?.correct).length;
  const question = questions[index]!;
  const result = answered[question.id];

  async function complete() {
    setBusy(true);
    const res = await apiRequest<Finish>(`/api/student/attempts/${attempt.attemptId}/finish`, {
      method: 'POST',
      locale,
    });
    setBusy(false);
    if (res.kind !== 'ok') return setFailed(true);
    setFinish(res.data);
    // Хедер: XP и серия (API-S-16); статусы тем атласа.
    await queryClient.invalidateQueries({ queryKey: ['me', 'stats'] });
    await queryClient.invalidateQueries({ queryKey: ['atlas'] });
  }

  async function choose(optionId: string) {
    if (busy || result) return;
    setBusy(true);
    const res = await apiRequest<Result>(`/api/student/attempts/${attempt.attemptId}/answers`, {
      method: 'POST',
      body: { questionId: question.id, optionId },
      locale,
    });
    setBusy(false);
    if (res.kind !== 'ok') return setFailed(true);
    setAnswered((prev) => ({ ...prev, [question.id]: { ...res.data, optionId } }));
    timer.current = window.setTimeout(() => {
      if (index < questions.length - 1) setIndex(index + 1);
      else void complete();
    }, NEXT_MS);
  }

  if (failed)
    return (
      <p role="alert" className="ai-placeholder">
        {tf('serverError')}
      </p>
    );

  if (finish) {
    const total = questions.length;
    return (
      <div className="ai-quiz-results fade-in text-center" data-testid="atlas-test-result">
        <h3 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{t('finish')}</h3>
        <div
          className="score-circle"
          style={{ fontSize: '2.5rem', fontWeight: 'bold', color: 'var(--primary)', margin: '1rem 0' }}
        >
          {score}/{total}
        </div>
        <p style={{ color: 'var(--text-secondary)' }}>
          {Math.round(finish.scorePercent)}% {t('correctPct')}
        </p>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }} data-testid="atlas-test-mastery">
          {finish.scorePercent >= MASTERY_THRESHOLD
            ? tq('masteredYes')
            : tq('masteredNo', { threshold: MASTERY_THRESHOLD })}
        </p>
        {finish.xpAwarded > 0 ? (
          <p className="atlas-xp" data-testid="atlas-test-xp">
            {tq('xp', { xp: finish.xpAwarded })}
          </p>
        ) : null}
        {finish.badgesAwarded.length ? (
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            {tq('badges')}: {finish.badgesAwarded.map((b) => b.title).join(', ')}
          </p>
        ) : null}
        <button
          type="button"
          className="ai-btn"
          onClick={onRetry}
          style={{ marginTop: '1.5rem', width: '100%', justifyContent: 'center' }}
        >
          {t('tryAgain')}
        </button>
      </div>
    );
  }

  return (
    <div className="ai-quiz fade-in" data-testid="atlas-test">
      <div
        className="ai-quiz-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 10,
          fontSize: '0.9rem',
          color: 'var(--text-secondary)',
        }}
      >
        <span data-testid="atlas-test-progress">
          {t('question')} {index + 1} / {questions.length}
        </span>
        <span>
          {t('score')}: {score}
        </span>
      </div>
      <p className="ai-quiz-question" id={`aq-${question.id}`}>
        {question.text}
      </p>
      <div className="ai-quiz-options" role="group" aria-labelledby={`aq-${question.id}`}>
        {question.options.map((o) => {
          const chosen = result?.optionId === o.id;
          const correct = result?.correctOptionId === o.id;
          return (
            <button
              key={o.id}
              type="button"
              className={`ai-quiz-opt${result && correct ? ' correct' : ''}${result && chosen && !correct ? ' incorrect' : ''}`}
              disabled={Boolean(result) || busy}
              onClick={() => void choose(o.id)}
              data-testid="atlas-test-option"
            >
              {o.text}
            </button>
          );
        })}
      </div>
      <div
        className="ai-quiz-feedback"
        aria-live="polite"
        style={{ color: result ? (result.correct ? 'var(--success)' : 'var(--accent-red)') : undefined }}
      >
        {result ? (result.correct ? t('correct') : t('incorrect')) : ''}
      </div>
    </div>
  );
}

/** Предпросмотр учителя (API-T-33): вопросы теста без правильных ответов, ничего не записывается. */
function TeacherPreview({ topicId }: { topicId: string }) {
  const t = useTranslations('atlas');
  const locale = useLocale();
  const subjectId = useAtlasSubject();
  const preview = useQuery({
    queryKey: ['teacher', 'atlas', 'topic', topicId, locale],
    queryFn: async () => {
      const res = await apiRequest<Preview>(`/api/teacher/atlas/${subjectId}/topics/${topicId}/questions`, {
        locale,
      });
      if (res.kind !== 'ok') throw new Error('preview');
      return res.data;
    },
  });
  return (
    <div className="ai-quiz fade-in" data-testid="atlas-test-preview">
      <PreviewNote>{t('preview.note')}</PreviewNote>
      {preview.data?.questions.map((q, i) => (
        <div key={i} style={{ marginBottom: '1.5rem' }}>
          <p className="ai-quiz-question">
            {i + 1}. {q.text}
          </p>
          <div className="ai-quiz-options">
            {q.options.map((o, j) => (
              <button key={j} type="button" className="ai-quiz-opt" disabled>
                {o}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
