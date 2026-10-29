'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import {
  studentEngine,
  type TeacherTest as TeacherTestDto,
  teacherAttempt,
  teacherEngine,
  topicSource,
} from '../../learn/test-engine';
import { GuestInvite, PreviewNote, useAtlasViewer } from './gate';
import { AtlasTestRun, type AtlasTestPlacement } from './test-view';

type Attempt = components['schemas']['AttemptDto'];

/** Где идёт тест темы атласа: «Открыть урок →» — окно элемента или раздел учёного; цвет свечения — цвет элемента. */
export interface TopicTestPlace {
  lessonHref: string;
  /** «× Завершить» и «К уроку»: окно элемента (или экран «Учёные») без теста. */
  backHref: string;
  onExit: () => void;
  accent?: string;
}

/**
 * Тест темы в стиле атласа (решения 4, А-3, А-5; docs/TESTS_TZ.md, REQ-TST-03.5): все три типа вопросов платформы —
 * выбор варианта, «Верно/Неверно», ввод ответа. Движок — квиз платформы: попытки, XP (BR-XP-01, вес подсказки 0,5 —
 * BR-TST-01), прогресс и освоение (BR-QZ-06/07), задание учителя (assignmentId, Q-18); правильный ответ приходит
 * только после ответа (BR-QZ-01). Гостю — вход; учитель проходит тот же тест в режиме предпросмотра (API-T-34):
 * проверка в браузере, ничего не записывается.
 */
export function TopicTest({
  topicId,
  quizId,
  assignmentId,
  place,
}: {
  topicId: string;
  quizId: string | null;
  assignmentId?: string;
  place: TopicTestPlace;
}) {
  const viewer = useAtlasViewer();
  if (viewer === 'guest') return <GuestInvite />;
  if (viewer === 'teacher') return <TeacherTest topicId={topicId} place={place} />;
  return quizId ? <StudentTest quizId={quizId} assignmentId={assignmentId} place={place} /> : null;
}

const placement = (place: TopicTestPlace, exitSaved: boolean): AtlasTestPlacement => ({
  back: 'toLesson',
  backHref: place.backHref,
  onExit: place.onExit,
  exitSaved,
});

function Loading() {
  const tq = useTranslations('student.quiz');
  return (
    <div className="typing-indicator" role="status" aria-label={tq('loading')}>
      <span />
      <span />
      <span />
    </div>
  );
}

function StudentTest({
  quizId,
  assignmentId,
  place,
}: {
  quizId: string;
  assignmentId?: string;
  place: TopicTestPlace;
}) {
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
  const data = attempt.data?.kind === 'ok' ? attempt.data.attempt : null;
  const source = useMemo(
    () => (data ? topicSource(data, studentEngine(data.attemptId, locale), place.lessonHref) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- источник — на попытку
    [data],
  );
  if (attempt.isPending) return <Loading />;
  if (attempt.data?.kind === 'empty') return <p className="ai-placeholder">{tq('empty')}</p>;
  if (!source)
    return (
      <p role="alert" className="ai-placeholder">
        {tf('serverError')}
      </p>
    );
  return (
    <AtlasTestRun
      key={data!.attemptId}
      source={source}
      // Незавершённая попытка продолжается при повторном входе (BR-QZ-06).
      placement={placement(place, true)}
      accent={place.accent}
      onRetry={() => setRound((r) => r + 1)}
      testId="atlas-test"
    />
  );
}

/** Учитель: тот же тест с пометкой предпросмотра; вопросы с ответами — API-T-34. */
function TeacherTest({ topicId, place }: { topicId: string; place: TopicTestPlace }) {
  const t = useTranslations('atlas');
  const tf = useTranslations('forms');
  const tq = useTranslations('student.quiz');
  const locale = useLocale();
  const [round, setRound] = useState(0);
  const test = useQuery({
    queryKey: ['teacher', 'test', topicId, locale],
    queryFn: async () => {
      const res = await apiRequest<TeacherTestDto>(`/api/teacher/topics/${topicId}/test`, { locale });
      if (res.kind !== 'ok') throw new Error('test');
      return res.data;
    },
    retry: false,
    refetchOnWindowFocus: false,
  });
  const source = useMemo(
    () =>
      test.data ? topicSource(teacherAttempt(test.data), teacherEngine(test.data), place.lessonHref) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- новый раунд — новый источник
    [test.data, round],
  );
  return (
    <div data-testid="atlas-test-preview">
      <PreviewNote>{t('preview.note')}</PreviewNote>
      {test.isPending ? (
        <Loading />
      ) : !test.data || !source ? (
        <p role="alert" className="ai-placeholder">
          {tf('serverError')}
        </p>
      ) : test.data.questions.length === 0 ? (
        <p className="ai-placeholder">{tq('empty')}</p>
      ) : (
        <AtlasTestRun
          key={round}
          source={source}
          placement={placement(place, false)}
          accent={place.accent}
          onRetry={() => setRound((r) => r + 1)}
          testId="atlas-test"
        />
      )}
    </div>
  );
}
