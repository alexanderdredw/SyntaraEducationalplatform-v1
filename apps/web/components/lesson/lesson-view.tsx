'use client';

import { type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, BookOpen, FileText, Lightbulb, PencilLine } from 'lucide-react';
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
  parent,
  level = 2,
}: {
  lesson: Lesson;
  subjectHref?: string;
  /** Раздел над предметом: урок предмета учителя — «← Мой класс / {Предмет} / {Тема}» (REQ-NAV-11, п. 3). */
  parent?: { href: string; label: string };
  level?: 1 | 2;
}) {
  const t = useTranslations('teacher.lesson');
  const tl = useTranslations('student.lesson');
  const Heading = level === 1 ? 'h1' : 'h2';
  const arrow = parent ? '' : '← ';
  return (
    <header className="flex flex-col gap-2">
      <nav aria-label={tl('breadcrumbs')} className="text-sm text-[var(--text-muted)]">
        {parent ? (
          <>
            <AppLink href={parent.href} className="hover:text-[var(--text)] hover:underline">
              {parent.label}
            </AppLink>
            <span aria-hidden="true" className="px-2">
              /
            </span>
          </>
        ) : null}
        {subjectHref ? (
          <AppLink href={subjectHref} className="hover:text-[var(--text)] hover:underline">
            {arrow}
            {lesson.subject.title}
          </AppLink>
        ) : (
          <span>
            {arrow}
            {lesson.subject.title}
          </span>
        )}
        <span aria-hidden="true" className="px-2">
          /
        </span>
        <span aria-current="page" className="text-[var(--text)]">
          {lesson.title}
        </span>
      </nav>
      <Heading className="mt-1 text-[2.25rem] font-bold leading-tight tracking-tight">{lesson.title}</Heading>
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
      <div className="grid items-start gap-x-12 gap-y-5 @2xl:grid-cols-[1fr_auto]">
        {/* Разделы аккордеона — в левой колонке, рядом с иллюстрацией (эталоны U04, U09, U12). */}
        <div className="flex min-w-0 flex-col gap-4">
          {lesson.summary ? <p className="text-lg">{lesson.summary}</p> : null}
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
          {lesson.sections.length ? (
            <Accordion
              items={lesson.sections.map((s) => ({
                value: s.id,
                title: (
                  <span className="flex items-baseline gap-4 font-semibold">
                    <span className="text-sm text-[var(--accent-bright)]">
                      {String(s.number).padStart(2, '0')}
                    </span>
                    <span className="text-[17px] text-[var(--text)]">{s.title}</span>
                  </span>
                ),
                // Иллюстрация раздела базового урока — из нашего хранилища, с подписью из файла (REQ-ST-LES-07).
                content:
                  s.body || s.illustrationUrl ? (
                    <div className="flex flex-col gap-3">
                      {s.illustrationUrl ? (
                        <img
                          src={s.illustrationUrl}
                          alt={s.illustrationAlt ?? ''}
                          loading="lazy"
                          className="w-full rounded-[var(--radius-field)] md:w-[var(--illustration-w)]"
                          data-testid="section-illustration"
                        />
                      ) : null}
                      {s.body ? <SafeMarkdown>{s.body}</SafeMarkdown> : null}
                    </div>
                  ) : null,
              }))}
            />
          ) : null}
        </div>
        {lesson.illustrationUrl ? (
          // Обложка темы — только из нашего хранилища (BR-FILE-04, BR-FILE-06).
          <img
            src={lesson.illustrationUrl}
            alt={lesson.illustrationAlt ?? ''}
            className="h-[190px] w-full rounded-[var(--radius-field)] border border-[var(--border)] object-cover shadow-popover @2xl:w-[336px]"
          />
        ) : null}
      </div>
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

/**
 * «СЛЕДУЮЩАЯ — {Тема} →» (REQ-ST-LES-03, PH-35): карточка справа — надпись «Следующая» мелко над названием
 * и стрелка (эталоны U05–U07); доступное имя — полный текст. У ученика — ссылка; переход не засчитывает тему.
 */
export function NextTopicCard({ lesson, href }: { lesson: Lesson; href?: string }) {
  const t = useTranslations('teacher.lesson');
  if (!lesson.next) return null;
  const full = t('next', { title: lesson.next.title });
  const body: ReactNode = (
    <span className="flex items-center justify-end gap-4 text-right">
      <span className="flex flex-col">
        <span className="text-xs uppercase tracking-[0.08em] text-[var(--text-muted)]">{t('nextLabel')}</span>
        <span className="text-[15px]">{lesson.next.title}</span>
      </span>
      <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-[var(--text-muted)]" />
    </span>
  );
  const box =
    'ml-auto block w-full rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-6 py-3.5 sm:max-w-[484px]';
  return href ? (
    <AppLink
      href={href}
      aria-label={full}
      data-testid="lesson-next"
      className={`${box} hover:border-[var(--border-strong)]`}
    >
      {body}
    </AppLink>
  ) : (
    <div className={box} aria-label={full} role="group">
      {body}
    </div>
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
