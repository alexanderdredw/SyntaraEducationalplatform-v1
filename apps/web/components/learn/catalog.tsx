'use client';

import { type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Accordion, EmptyState, Pill, Skeleton } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { AppLink } from '../app-link';
import { useClassOverview, useIsClassSubject, useReportSubject } from '../cabinet/nav-state';
import { MY_CLASS_HREF } from '../cabinet/nav';
import { useLearnViewer } from './viewer';

/** REQ-PTBL-08: таблица Менделеева — отдельный чанк, загружается только на странице предмета с блоком. */
const PeriodicTable = dynamic(() => import('./periodic-table'), {
  loading: () => <Skeleton className="h-96" />,
});

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

/**
 * Запрос к API от имени зрителя: ученик — API-S-*, гость — API-PUB-10..13 (BR-VIS-04). `baseOnly` — только базовые
 * предметы платформы (API-PUB-10/11) и у ученика: каталог без предметов учителя (REQ-NAV-12).
 */
function useApi<T>(key: unknown[], path: string, baseOnly = false) {
  const locale = useLocale();
  const { guest } = useLearnViewer();
  const pub = guest || baseOnly;
  const url = pub ? path.replace('/api/student/', '/api/public/') : path;
  return useQuery({
    queryKey: [...key, pub, locale],
    queryFn: async () => {
      const res = await apiRequest<T>(url, { locale });
      if (res.kind !== 'ok') throw new Error(url);
      return res.data;
    },
  });
}

/**
 * «Предметы платформы» (REQ-ST-CAT-02, U13): разделы и базовые предметы, сетка в 3 колонки. Предметы учителя —
 * в «Мой класс» (REQ-NAV-12): каталог ученика берёт только базовые предметы (API-PUB-10), доступ не меняется.
 * `heading` — уровень заголовка: у ученика это заголовок страницы, у гостя — блок под «Предметы».
 */
export function StudentCatalog({ heading = 2 }: { heading?: 1 | 2 }) {
  const t = useTranslations('student.catalog');
  const catalog = useApi<Catalog>(['student', 'catalog'], '/api/student/catalog', true);
  const Heading = heading === 1 ? 'h1' : 'h2';
  return (
    <section aria-labelledby="catalog-title" className="flex flex-col gap-4" data-testid="student-catalog">
      <Heading
        id="catalog-title"
        className={heading === 1 ? 'text-cabinet-title font-bold' : 'text-cabinet-block font-semibold'}
      >
        {t('title')}
      </Heading>
      {heading === 1 ? <ClassSubjectsLink /> : null}
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

/**
 * REQ-NAV-12, п. 3: тонкая плашка «Предметы от твоего учителя — в разделе „Мой класс“ →» — только если ученик в
 * классе и у класса есть предметы.
 */
function ClassSubjectsLink() {
  const t = useTranslations('student.catalog');
  const overview = useClassOverview();
  if (!overview.data?.subjects.length) return null;
  return (
    <AppLink
      href={MY_CLASS_HREF}
      data-testid="catalog-class-link"
      className="inline-flex min-h-11 w-fit items-center rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface)] px-4 text-sm hover:border-[var(--border-strong)]"
    >
      {t('classLink')}
    </AppLink>
  );
}

function PageShell({
  back,
  backHref = '/learn/subjects',
  title,
  children,
}: {
  back: string;
  backHref?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className="mx-auto flex max-w-[1012px] flex-col gap-6 px-4 py-8">
      <AppLink
        href={backHref}
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
  const section = useApi<Section>(['student', 'section', id], `/api/student/sections/${id}`, true);
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

type SubjectTopic = Subject['topics'][number];

/** Тема в списке предмета: «Тема N», название и статус ученика (решение владельца 2026-10-16). */
function TopicLink({ topic }: { topic: SubjectTopic }) {
  const t = useTranslations('student.subject');
  return (
    <AppLink
      href={`/learn/topics/${topic.id}`}
      data-testid="student-topic"
      data-status={topic.status}
      className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-card hover:border-[var(--border-strong)]"
    >
      <span className="flex flex-col">
        <span className="text-xs text-[var(--text-muted)]">{t('number', { number: topic.number })}</span>
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
  );
}

function TopicList({ topics }: { topics: SubjectTopic[] }) {
  return (
    <ol className="flex flex-col gap-2 text-[var(--text)]" data-testid="subject-topics">
      {topics.map((topic) => (
        <li key={topic.id}>
          <TopicLink topic={topic} />
        </li>
      ))}
    </ol>
  );
}

/**
 * Главы предмета (BR-CHAP-03): темы сгруппированы по главам; у ученика в заголовке главы — «Освоено m из n».
 * Главы сворачиваются; при первом показе раскрыта первая неосвоенная глава (у гостя — первая).
 */
function ChapterList({ subject }: { subject: Subject & { chapters: NonNullable<Subject['chapters']> } }) {
  const t = useTranslations('student.subject');
  const byId = new Map(subject.topics.map((topic) => [topic.id, topic]));
  const chapters = subject.chapters.map((c) => {
    const topics = c.topicIds.flatMap((id) => byId.get(id) ?? []);
    return { ...c, topics, mastered: topics.filter((topic) => topic.status === 'mastered').length };
  });
  const open = chapters.find((c) => c.mastered < c.topics.length);
  return (
    <div data-testid="subject-chapters">
      <Accordion
        defaultValue={open ? [open.id] : []}
        items={chapters.map((c) => ({
          value: c.id,
          title: (
            <span className="flex flex-col gap-1" data-testid="subject-chapter">
              <span className="text-cabinet-block font-semibold text-[var(--text)]">{c.title}</span>
              {c.topics.some((topic) => topic.status) ? (
                <span className="text-sm text-[var(--text-muted)]" data-testid="chapter-progress">
                  {t('chapterProgress', { mastered: c.mastered, total: c.topics.length })}
                </span>
              ) : null}
            </span>
          ),
          content: <TopicList topics={c.topics} />,
        }))}
      />
    </div>
  );
}

/**
 * Страница предмета ученика (решение владельца 2026-10-14): опубликованные темы по порядку (PH-35 — без
 * блокировки), у базового предмета с главами — по главам (BR-CHAP-03). Сюда ведут карточка предмета, крошки
 * урока и «Перейти к предмету».
 */
export function StudentSubject({ id }: { id: string }) {
  const t = useTranslations('student.subject');
  const tc = useTranslations('student.myClass');
  const tg = useTranslations('student.glossary');
  const { guest } = useLearnViewer();
  const subject = useApi<Subject>(['student', 'subject', id], `/api/student/subjects/${id}`);
  // Предмет учителя: назад — в «Мой класс», в панели активен «Мой класс» (REQ-NAV-11, п. 3; REQ-NAV-13).
  const inClass = useIsClassSubject(id, !guest);
  useReportSubject(guest ? null : id);
  return (
    <PageShell
      back={inClass ? tc('back') : t('back')}
      backHref={inClass ? MY_CLASS_HREF : undefined}
      title={subject.data?.title}
    >
      {subject.data?.description ? (
        <p className="text-[var(--text-muted)]">{subject.data.description}</p>
      ) : null}
      {/* REQ-GLOS-02: кнопка — только если у предмета есть глоссарий. */}
      {subject.data?.hasGlossary ? (
        <AppLink
          href={`/learn/subjects/${id}/glossary`}
          data-testid="subject-glossary-link"
          className="inline-flex min-h-11 w-fit items-center rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium hover:border-[var(--border-strong)]"
        >
          {tg('title')}
        </AppLink>
      ) : null}
      {/* REQ-PTBL-01: блок над главами — только если включён в subject.yaml. */}
      {subject.data?.periodicTable ? (
        <PeriodicTable
          elements={subject.data.periodicTable.elements}
          statuses={new Map(subject.data.topics.map((topic) => [topic.id, topic.status]))}
        />
      ) : null}
      <section aria-labelledby="subject-topics" className="flex flex-col gap-3">
        <h2 id="subject-topics" className="text-cabinet-block font-semibold">
          {t('topics')}
        </h2>
        {subject.data?.topics.length === 0 ? <EmptyState title={t('empty')} /> : null}
        {subject.data?.chapters?.length ? (
          <ChapterList subject={{ ...subject.data, chapters: subject.data.chapters }} />
        ) : subject.data ? (
          <TopicList topics={subject.data.topics} />
        ) : null}
      </section>
    </PageShell>
  );
}
