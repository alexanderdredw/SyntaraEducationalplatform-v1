'use client';

import { useEffect, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { localDate } from '@syntara/shared';
import { BookOpen, MessageCircle, PencilLine } from 'lucide-react';
import { Pill, Skeleton, Tabs } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import { loginEntryHref } from '@/lib/auth';
import { LessonHeader, LessonOverview, type Lesson, NextTopicCard } from '../lesson/lesson-view';
import type { LessonMarkdown } from '../markdown/lesson-markdown';
import { lessonQueryKey } from './query-keys';
import { LinkButton } from '../public/blocks';
import { StudentQuiz } from './quiz';
import { TutorChatLoader } from './tutor-chat-loader';
import { MY_CLASS_HREF } from '../cabinet/nav';
import { useIsClassSubject, useReportSubject } from '../cabinet/nav-state';
import { useLearnViewer } from './viewer';

export const LESSON_TABS = ['overview', 'quiz', 'ai'] as const;
export type LessonTab = (typeof LESSON_TABS)[number];
const tabOf = (value: string | null): LessonTab =>
  (LESSON_TABS as readonly string[]).includes(value ?? '') ? (value as LessonTab) : 'overview';

/**
 * Урок ученика (/learn/topics/:id, 8.4.3, U04–U05): опубликованный снимок темы (API-S-06), вкладки «Обзор»,
 * «Квиз», «Syntara AI» в параметре `?tab=` — без перезагрузки и без потери состояния при смене языка или темы
 * оформления (REQ-ST-LES-01, REQ-ST-LES-05, AC-ST-01). Открытие — событие lesson_opened (REQ-ST-LES-04).
 */
export function LessonPage({
  topicId,
  timeZone,
  markdown,
}: {
  topicId: string;
  timeZone: string;
  /** Markdown урока, отрисованный на сервере вместе с данными урока (OPT-05, О4-2, О4-4). */
  markdown?: LessonMarkdown;
}) {
  const t = useTranslations('student.lesson');
  const locale = useLocale();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  // Вкладка — из адреса: replaceState обновляет useSearchParams без запроса к серверу; «назад» тоже работает.
  const tab = tabOf(params.get('tab'));
  const opened = useRef(false);
  const { guest, cabinetHref, api } = useLearnViewer();
  const tc = useTranslations('cabinet');
  const tm = useTranslations('student.myClass');

  const lesson = useQuery({
    queryKey: lessonQueryKey(topicId, guest, locale),
    queryFn: async () => {
      // Гость — «Обзор» базового урока (API-PUB-13), ученик — API-S-06.
      const res = await apiRequest<Lesson>(`${api}/topics/${topicId}`, { locale });
      if (res.kind !== 'ok') throw new Error('lesson');
      return res.data;
    },
  });

  // Урок предмета учителя: крошки «← Мой класс / …», в панели активен «Мой класс» (REQ-NAV-11, REQ-NAV-13).
  const subjectId = lesson.data?.subject.id;
  useReportSubject(guest ? null : subjectId);
  const inClass = useIsClassSubject(subjectId, !guest);

  // REQ-ST-LES-04: одно событие в день на тему (ключ lesson:{topicId}:{дата в PLATFORM_TZ}).
  // Гостю событие, XP и прогресс не создаются (REQ-ST-LES-06).
  useEffect(() => {
    if (guest || opened.current || !lesson.data) return;
    opened.current = true;
    void apiRequest('/api/student/events', {
      method: 'POST',
      body: {
        type: 'lesson_opened',
        topicId,
        idempotencyKey: `lesson:${topicId}:${localDate(new Date(), timeZone)}`,
      },
      locale,
    }).then(() => queryClient.invalidateQueries({ queryKey: ['me', 'stats'] }));
  }, [guest, lesson.data, topicId, timeZone, locale, queryClient]);

  function select(next: string) {
    const value = tabOf(next);
    // Без перезагрузки и без запроса к серверу: меняется только ?tab (REQ-ST-LES-01).
    const url = new URL(window.location.href);
    url.searchParams.set('tab', value);
    // null — так Next.js синхронизирует useSearchParams (своё внутреннее состояние истории он восстанавливает сам).
    window.history.replaceState(null, '', url);
  }

  if (!lesson.data) {
    return (
      <section className="mx-auto flex max-w-[1012px] flex-col gap-4 px-4 py-8">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64" />
      </section>
    );
  }
  const data = lesson.data;
  // REQ-ST-LES-06: на «Квиз» и «Syntara AI» гостю — приглашение войти с возвратом на эту вкладку урока.
  // REQ-NAV-05: вошедшему без роли ученика (учитель) «Войти» не показывается — «Перейти в кабинет →».
  // TODO(OWNER): поясняющий текст на «Квиз» и «Syntara AI» базового урока для учителя (SPEC молчит).
  const invite = (tabValue: LessonTab) =>
    cabinetHref ? (
      <div className="flex flex-col items-start gap-4 py-4" data-testid="signed-in-invite">
        <LinkButton variant="blue" href={cabinetHref} testId="to-cabinet">
          {tc('toCabinet')}
        </LinkButton>
      </div>
    ) : (
      <div className="flex flex-col items-start gap-4 py-4" data-testid="guest-invite">
        <p className="text-lg">{t(tabValue === 'ai' ? 'guestInviteAi' : 'guestInvite')}</p>
        <LinkButton
          variant="blue"
          // BR-AUTH-01: вход ученика — «Я ученик», с возвратом на эту вкладку урока.
          href={loginEntryHref(`/learn/topics/${topicId}?tab=${tabValue}`)}
          testId="guest-login"
        >
          {t('guestLogin')}
        </LinkButton>
      </div>
    );
  return (
    <article
      lang={data.locale}
      className="mx-auto flex max-w-[1012px] flex-col gap-6 px-4 py-8"
      data-testid="lesson-page"
    >
      <LessonHeader
        lesson={data}
        level={1}
        subjectHref={`/learn/subjects/${data.subject.id}`}
        parent={inClass ? { href: MY_CLASS_HREF, label: tm('back') } : undefined}
      />
      {/* REQ-ST-LES-07, BR-CNT-05: пометки языка урока. */}
      {data.needsReview || (data.locale === 'ru' && locale !== 'ru') ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="lesson-language">
          {data.needsReview ? <Pill data-testid="lesson-needs-review">{t('needsReview')}</Pill> : null}
          {data.locale === 'ru' && locale !== 'ru' ? (
            <p className="text-sm text-[var(--text-muted)]" data-testid="lesson-fallback">
              {t('onlyRussian')}
            </p>
          ) : null}
        </div>
      ) : null}
      <Tabs
        label={t('tabs')}
        value={tab}
        onValueChange={select}
        items={[
          {
            value: 'overview',
            label: t('overview'),
            icon: <BookOpen />,
            content: <LessonOverview lesson={data} markdown={markdown} />,
          },
          {
            value: 'quiz',
            label: t('quiz'),
            icon: <PencilLine />,
            content: guest ? (
              invite('quiz')
            ) : data.quizId ? (
              <StudentQuiz quizId={data.quizId} assignmentId={params.get('assignment') ?? undefined} />
            ) : null,
          },
          {
            value: 'ai',
            label: t('ai'),
            icon: <MessageCircle />,
            // Учебный ИИ по теме урока (8.4.5, REQ-ST-AI-01..02); гостю — приглашение войти.
            content: guest ? (
              invite('ai')
            ) : (
              <TutorChatLoader
                context="topic_tutor"
                topicId={topicId}
                topicTitle={data.title}
                inputId="tutor-input"
              />
            ),
          },
        ]}
      />
      <div className="mt-6 border-t border-[var(--border)] pt-6">
        <NextTopicCard lesson={data} href={data.next ? `/learn/topics/${data.next.id}` : undefined} />
      </div>
    </article>
  );
}
