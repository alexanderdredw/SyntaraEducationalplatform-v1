'use client';

import { type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { BookOpen, FileText, Lightbulb, PencilLine } from 'lucide-react';
import { Accordion, Card } from '@syntara/ui';
import type { components } from '@/lib/api/schema';
import { AppLink } from '../app-link';
import { SafeMarkdown } from '../markdown/safe-markdown';

export type Lesson = components['schemas']['LessonDto'];

/**
 * Шапка урока (REQ-ST-LES-01): «← {Предмет} / {Тема}», заголовок, «Тема {N}», «{K} вопросов».
 * `subjectHref` — ссылка на предмет у ученика; в предпросмотре учителя крошки — текст.
 */
export function LessonHeader({
  lesson,
  subjectHref,
  level = 2,
}: {
  lesson: Lesson;
  subjectHref?: string;
  level?: 1 | 2;
}) {
  const t = useTranslations('teacher.lesson');
  const tl = useTranslations('student.lesson');
  const Heading = level === 1 ? 'h1' : 'h2';
  return (
    <header className="flex flex-col gap-2">
      <nav aria-label={tl('breadcrumbs')} className="text-sm text-[var(--text-muted)]">
        {subjectHref ? (
          <AppLink href={subjectHref} className="hover:text-[var(--text)] hover:underline">
            ← {lesson.subject.title}
          </AppLink>
        ) : (
          <span>← {lesson.subject.title}</span>
        )}
        <span aria-hidden="true"> / </span>
        <span aria-current="page" className="text-[var(--text)]">
          {lesson.title}
        </span>
      </nav>
      <Heading className="text-cabinet-title font-bold">{lesson.title}</Heading>
      <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-1">
          <BookOpen aria-hidden="true" className="size-4" />
          {t('number', { number: lesson.number })}
        </span>
        <span aria-hidden="true">·</span>
        <span className="inline-flex items-center gap-1">
          <PencilLine aria-hidden="true" className="size-4" />
          {t('questions', { count: lesson.questionsCount })}
        </span>
      </p>
    </header>
  );
}

/**
 * Вкладка «Обзор» (REQ-ST-LES-02): описание; карточка «Интересный факт» — после описания, перед текстом урока
 * (решение владельца 2026-10-16); текст (SafeMarkdown, REQ-NFR-SEC-06); материалы (только прошедшие проверку);
 * иллюстрация справа; аккордеон разделов — все свёрнуты, можно раскрыть несколько (PH-36).
 */
export function LessonOverview({ lesson }: { lesson: Lesson }) {
  const t = useTranslations('teacher.lesson');
  return (
    <div className="@container flex flex-col gap-5" data-testid="lesson-overview">
      {/* Ширина колонок — по ширине самого урока (окно предпросмотра, страница ученика). */}
      <div className="grid gap-5 @2xl:grid-cols-[1fr_auto]">
        <div className="flex min-w-0 flex-col gap-4">
          {lesson.summary ? <p className="text-lg text-[var(--text-muted)]">{lesson.summary}</p> : null}
          {lesson.funFact ? (
            <Card className="flex flex-col gap-1 p-4" data-testid="lesson-fun-fact">
              <h3 className="flex items-center gap-2 font-semibold">
                <Lightbulb aria-hidden="true" className="size-4 text-[var(--warning)]" />
                {t('funFact')}
              </h3>
              <p>{lesson.funFact}</p>
            </Card>
          ) : null}
          {lesson.bodyMd ? <SafeMarkdown>{lesson.bodyMd}</SafeMarkdown> : null}
        </div>
        {lesson.illustrationUrl ? (
          // Обложка темы — только из нашего хранилища (BR-FILE-04, BR-FILE-06).
          <img
            src={lesson.illustrationUrl}
            alt=""
            className="h-[190px] w-full rounded-[var(--radius-field)] object-cover @2xl:w-[336px]"
          />
        ) : null}
      </div>
      {lesson.sections.length ? (
        <Accordion
          items={lesson.sections.map((s) => ({
            value: s.id,
            title: (
              <span className="font-semibold">
                <span className="text-[var(--accent)]">{String(s.number).padStart(2, '0')}</span> {s.title}
              </span>
            ),
            content: s.body ? <SafeMarkdown>{s.body}</SafeMarkdown> : null,
          }))}
        />
      ) : null}
      {lesson.materials.length ? (
        <section className="flex flex-col gap-2" data-testid="lesson-materials">
          <h3 className="font-semibold">{t('materials')}</h3>
          <ul className="flex flex-col gap-1">
            {lesson.materials.map((m) => (
              <li key={m.id}>
                <a
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-2 text-[var(--accent)] hover:underline"
                >
                  <FileText aria-hidden="true" className="size-4" />
                  {m.name}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** «СЛЕДУЮЩАЯ — {Тема} →» (REQ-ST-LES-03, PH-35): у ученика — ссылка; переход не засчитывает текущую тему. */
export function NextTopicCard({ lesson, href }: { lesson: Lesson; href?: string }) {
  const t = useTranslations('teacher.lesson');
  if (!lesson.next) return null;
  const body: ReactNode = <span className="font-semibold">{t('next', { title: lesson.next.title })}</span>;
  return href ? (
    <AppLink
      href={href}
      data-testid="lesson-next"
      className="block rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-card hover:border-[var(--border-strong)]"
    >
      {body}
    </AppLink>
  ) : (
    <Card className="p-4">{body}</Card>
  );
}

/** Урок целиком без вкладок — предпросмотр «Посмотреть глазами ученика» (API-T-15, REQ-TCH-PUB-02). */
export function LessonView({ lesson }: { lesson: Lesson }) {
  return (
    <article lang={lesson.locale} className="flex flex-col gap-5" data-testid="lesson-view">
      <LessonHeader lesson={lesson} />
      <LessonOverview lesson={lesson} />
      <NextTopicCard lesson={lesson} />
    </article>
  );
}
