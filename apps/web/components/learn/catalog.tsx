'use client';

import { type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, Pill, Skeleton } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { AppLink } from '../app-link';
import { useLearnViewer } from './viewer';

type Catalog = components['schemas']['CatalogDto'];
type Section = components['schemas']['SectionDto'];
/** Страница предмета: у ученика темы со статусами (API-S-18), у гостя — без (API-PUB-12). */
type Subject = Omit<components['schemas']['StudentSubjectDto'], 'topics'> & {
  topics: Array<
    | components['schemas']['StudentSubjectDto']['topics'][number]
    | (components['schemas']['PublicSubjectPageDto']['topics'][number] & { status?: undefined })
  >;
};

/**
 * Карточка каталога: вся карточка — ссылка, без отдельной кнопки (REQ-ST-CAT-02). Предмет без опубликованных
 * тем — «Скоро», карточка не кликабельна (BR-CNT-08).
 */
function CatalogCard({
  href,
  title,
  description,
  status,
  testId,
  soon = false,
}: {
  href: string;
  title: string;
  description: string | null;
  status: string;
  testId: string;
  soon?: boolean;
}) {
  const className =
    'flex h-full min-h-[122px] flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-6 py-5';
  const body = (
    <>
      <span className="flex items-start justify-between gap-3">
        {/* Пользовательские названия не переводятся (REQ-ST-CAT-02). */}
        <span className="pt-2 text-cabinet-block font-semibold">{title}</span>
        <Pill className={soon ? 'shrink-0 text-[var(--text-muted)]' : 'shrink-0'}>{status}</Pill>
      </span>
      {description ? <span className="text-sm text-[var(--text-muted)]">{description}</span> : null}
    </>
  );
  return (
    <li>
      {soon ? (
        <div data-testid={testId} data-status="soon" className={className}>
          {body}
        </div>
      ) : (
        <AppLink
          href={href}
          data-testid={testId}
          className={`${className} hover:border-[var(--border-strong)]`}
        >
          {body}
        </AppLink>
      )}
    </li>
  );
}

const grid = 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3';

/** Запрос к API от имени зрителя: ученик — API-S-*, гость — API-PUB-10..13 (BR-VIS-04). */
function useApi<T>(key: unknown[], path: string) {
  const locale = useLocale();
  const { guest } = useLearnViewer();
  const url = guest ? path.replace('/api/student/', '/api/public/') : path;
  return useQuery({
    queryKey: [...key, guest, locale],
    queryFn: async () => {
      const res = await apiRequest<T>(url, { locale });
      if (res.kind !== 'ok') throw new Error(url);
      return res.data;
    },
  });
}

/** «Предметы платформы» (API-S-04, REQ-ST-CAT-02, U13): разделы и доступные предметы, сетка в 3 колонки. */
export function StudentCatalog() {
  const t = useTranslations('student.catalog');
  const catalog = useApi<Catalog>(['student', 'catalog'], '/api/student/catalog');
  return (
    <section aria-labelledby="catalog-title" className="flex flex-col gap-4" data-testid="student-catalog">
      <h2 id="catalog-title" className="text-cabinet-block font-semibold">
        {t('title')}
      </h2>
      {catalog.isPending ? <Skeleton className="h-32" /> : null}
      {catalog.data && catalog.data.sections.length + catalog.data.subjects.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : null}
      <ul className={grid}>
        {catalog.data?.sections.map((s) => (
          <CatalogCard
            key={s.id}
            href={`/learn/sections/${s.id}`}
            title={s.title}
            description={s.description}
            status={t('section')}
            testId="catalog-section"
          />
        ))}
        {catalog.data?.subjects.map((s) => (
          <CatalogCard
            key={s.id}
            href={`/learn/subjects/${s.id}`}
            title={s.title}
            description={s.description}
            status={s.status === 'soon' ? t('soon') : t('available')}
            soon={s.status === 'soon'}
            testId="catalog-subject"
          />
        ))}
      </ul>
    </section>
  );
}

function PageShell({ back, title, children }: { back: string; title?: string; children: ReactNode }) {
  return (
    <section className="mx-auto flex max-w-[1012px] flex-col gap-6 px-4 py-8">
      <AppLink
        href="/learn/subjects"
        className="inline-flex min-h-11 w-fit items-center text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
      >
        {back}
      </AppLink>
      {title !== undefined ? (
        <h1 className="text-cabinet-title font-bold">{title}</h1>
      ) : (
        <Skeleton className="h-9 w-1/2" />
      )}
      {children}
    </section>
  );
}

/** Раздел каталога (/learn/sections/:id, API-S-05, REQ-ST-CAT-03, U03). */
export function StudentSection({ id }: { id: string }) {
  const t = useTranslations('student');
  const section = useApi<Section>(['student', 'section', id], `/api/student/sections/${id}`);
  return (
    <PageShell back={t('section.back')} title={section.data?.title}>
      {section.data?.description ? (
        <p className="text-[var(--text-muted)]">{section.data.description}</p>
      ) : null}
      {section.data?.subjects.length === 0 ? <EmptyState title={t('section.empty')} /> : null}
      <ul className={grid} data-testid="section-subjects">
        {section.data?.subjects.map((s) => (
          <CatalogCard
            key={s.id}
            href={`/learn/subjects/${s.id}`}
            title={s.title}
            description={s.description}
            status={s.status === 'soon' ? t('catalog.soon') : t('catalog.available')}
            soon={s.status === 'soon'}
            testId="catalog-subject"
          />
        ))}
      </ul>
    </PageShell>
  );
}

/**
 * Страница предмета ученика (решение владельца 2026-10-14): опубликованные темы по порядку (PH-35 — без
 * блокировки). Сюда ведут карточка предмета, крошки урока и «Перейти к предмету».
 */
export function StudentSubject({ id }: { id: string }) {
  const t = useTranslations('student.subject');
  const subject = useApi<Subject>(['student', 'subject', id], `/api/student/subjects/${id}`);
  return (
    <PageShell back={t('back')} title={subject.data?.title}>
      {subject.data?.description ? (
        <p className="text-[var(--text-muted)]">{subject.data.description}</p>
      ) : null}
      <section aria-labelledby="subject-topics" className="flex flex-col gap-3">
        <h2 id="subject-topics" className="text-cabinet-block font-semibold">
          {t('topics')}
        </h2>
        {subject.data?.topics.length === 0 ? <EmptyState title={t('empty')} /> : null}
        <ol className="flex flex-col gap-2" data-testid="subject-topics">
          {subject.data?.topics.map((topic) => (
            <li key={topic.id}>
              <AppLink
                href={`/learn/topics/${topic.id}`}
                data-testid="student-topic"
                data-status={topic.status}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-card hover:border-[var(--border-strong)]"
              >
                <span className="flex flex-col">
                  <span className="text-xs text-[var(--text-muted)]">
                    {t('number', { number: topic.number })}
                  </span>
                  <span className="font-medium">{topic.title}</span>
                </span>
                {/* Статус темы для ученика (решение владельца 2026-10-16); гостю статусы не показываются. */}
                {topic.status ? (
                  <Pill
                    className={
                      topic.status === 'mastered'
                        ? 'border-[var(--success)] text-[var(--text)]'
                        : topic.status === 'started'
                          ? 'border-[var(--accent)] text-[var(--text)]'
                          : 'text-[var(--text-muted)]'
                    }
                  >
                    {t(`status.${topic.status}`)}
                  </Pill>
                ) : null}
              </AppLink>
            </li>
          ))}
        </ol>
      </section>
    </PageShell>
  );
}
