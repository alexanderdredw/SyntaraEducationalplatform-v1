'use client';

import { useTranslations } from 'next-intl';
import { FileText } from 'lucide-react';
import { Accordion, Card } from '@syntara/ui';
import type { components } from '@/lib/api/schema';
import { SafeMarkdown } from '../markdown/safe-markdown';

export type Lesson = components['schemas']['LessonDto'];

/**
 * Урок глазами ученика (8.4.3, вкладка «Обзор») — заготовка общего компонента: здесь его использует
 * предпросмотр учителя (API-T-15, REQ-TCH-PUB-02), полная страница урока с вкладками — итерация 8.
 * Пользовательский текст — через SafeMarkdown (REQ-NFR-SEC-06).
 */
export function LessonView({ lesson }: { lesson: Lesson }) {
  const t = useTranslations('teacher.lesson');
  return (
    <article lang={lesson.locale} className="@container flex flex-col gap-5" data-testid="lesson-view">
      <p className="text-sm text-[var(--text-muted)]">
        ← {lesson.subject.title} / {lesson.title}
      </p>
      <header className="flex flex-col gap-1">
        <h2 className="text-cabinet-title font-bold">{lesson.title}</h2>
        <p className="text-sm text-[var(--text-muted)]">
          {t('number', { number: lesson.number })} · {t('questions', { count: lesson.questionsCount })}
        </p>
      </header>
      {/* Ширина колонок — по ширине самого урока (окно предпросмотра, страница ученика). */}
      <div className="grid gap-5 @2xl:grid-cols-[1fr_auto]">
        <div className="flex min-w-0 flex-col gap-4">
          {lesson.summary ? <p className="text-[var(--text-muted)]">{lesson.summary}</p> : null}
          {lesson.bodyMd ? <SafeMarkdown>{lesson.bodyMd}</SafeMarkdown> : null}
        </div>
        {lesson.illustrationUrl ? (
          // Обложка темы: файл из хранилища (подписанная ссылка) или внешняя https-ссылка.
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
                {String(s.number).padStart(2, '0')} {s.title}
              </span>
            ),
            content: s.body ? <SafeMarkdown>{s.body}</SafeMarkdown> : null,
          }))}
        />
      ) : null}
      {lesson.materials.length ? (
        <section className="flex flex-col gap-2">
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
      {lesson.next ? (
        <Card className="p-4 font-semibold">{t('next', { title: lesson.next.title })}</Card>
      ) : null}
    </article>
  );
}
