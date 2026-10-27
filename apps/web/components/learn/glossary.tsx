'use client';

import { Fragment, useDeferredValue, useId, useMemo, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, Input, Pill, Skeleton } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { AppLink } from '../app-link';
import { useLearnViewer } from './viewer';

type Glossary = components['schemas']['GlossaryDto'];

/** REQ-GLOS-03: поиск без учёта регистра и «ё/е» — замена посимвольная, индексы совпадений сохраняются. */
const normalize = (s: string) => s.toLocaleLowerCase().replace(/ё/g, 'е');

/** Подсветка всех вхождений запроса (по нормализованному тексту). */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return text;
  const hay = normalize(text);
  const parts: ReactNode[] = [];
  let from = 0;
  for (let i = hay.indexOf(query); i >= 0; i = hay.indexOf(query, i + query.length)) {
    parts.push(text.slice(from, i), <mark key={i}>{text.slice(i, i + query.length)}</mark>);
    from = i + query.length;
  }
  parts.push(text.slice(from));
  return parts.map((p, i) => <Fragment key={i}>{p}</Fragment>);
}

/**
 * Глоссарий предмета (/learn/subjects/:id/glossary, REQ-GLOS-02…06): разделы как в источнике, внутри — термины по
 * алфавиту языка интерфейса (порядок задаёт API); поиск по термину и определению с подсветкой; на телефоне —
 * одна колонка, поле поиска закреплено сверху. Ученику — API-S-22, гостю — API-PUB-14 (BR-VIS-04).
 */
export function SubjectGlossary({ id }: { id: string }) {
  const t = useTranslations('student.glossary');
  const tl = useTranslations('student.lesson');
  const locale = useLocale();
  const { guest } = useLearnViewer();
  const searchId = useId();
  const [input, setInput] = useState('');
  const query = normalize(useDeferredValue(input).trim());
  const url = `/api/${guest ? 'public' : 'student'}/subjects/${id}/glossary`;
  const glossary = useQuery({
    queryKey: ['student', 'glossary', id, guest, locale],
    queryFn: async () => {
      const res = await apiRequest<Glossary>(url, { locale });
      if (res.kind !== 'ok') throw new Error(url);
      return res.data;
    },
  });
  const sections = useMemo(
    () =>
      (glossary.data?.sections ?? [])
        .map((s) => ({
          ...s,
          terms: query
            ? s.terms.filter((term) => normalize(`${term.term} ${term.definition}`).includes(query))
            : s.terms,
        }))
        .filter((s) => s.terms.length > 0),
    [glossary.data, query],
  );
  const found = sections.reduce((n, s) => n + s.terms.length, 0);

  return (
    <section className="mx-auto flex max-w-[1012px] flex-col gap-6 px-4 py-8" data-testid="glossary">
      {/* REQ-GLOS-06: «Каталог / {Предмет} / Глоссарий». */}
      <nav aria-label={tl('breadcrumbs')} className="text-sm text-[var(--text-muted)]">
        <AppLink href="/learn/subjects" className="hover:text-[var(--text)] hover:underline">
          {t('catalog')}
        </AppLink>
        <span aria-hidden="true" className="px-2">
          /
        </span>
        <AppLink href={`/learn/subjects/${id}`} className="hover:text-[var(--text)] hover:underline">
          {glossary.data?.subject.title ?? '…'}
        </AppLink>
        <span aria-hidden="true" className="px-2">
          /
        </span>
        <span aria-current="page" className="text-[var(--text)]">
          {t('title')}
        </span>
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-cabinet-title font-bold">{t('title')}</h1>
        {glossary.data?.needsReview ? (
          <Pill data-testid="glossary-needs-review">{tl('needsReview')}</Pill>
        ) : null}
      </div>
      <div className="sticky top-[var(--header-h)] z-10 -mx-4 bg-[var(--bg)] px-4 py-2 md:static md:mx-0 md:px-0">
        <label htmlFor={searchId} className="mb-1 block text-sm font-medium">
          {t('search')}
        </label>
        <Input
          id={searchId}
          type="search"
          value={input}
          placeholder={t('placeholder')}
          onChange={(e) => setInput(e.target.value)}
          data-testid="glossary-search"
        />
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {glossary.data ? t('found', { count: found }) : ''}
      </p>
      {glossary.isPending ? <Skeleton className="h-64" /> : null}
      {glossary.data && found === 0 ? <EmptyState title={t('empty')} /> : null}
      {sections.map((s) => (
        <section
          key={s.id}
          aria-labelledby={`g-${s.id}`}
          className="flex flex-col gap-3"
          data-testid="glossary-section"
        >
          <h2 id={`g-${s.id}`} className="text-cabinet-block font-semibold">
            {s.title}
          </h2>
          <dl className="grid gap-3 md:grid-cols-2">
            {s.terms.map((term) => (
              <div
                key={term.id}
                className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4"
                data-testid="glossary-term"
              >
                <dt className="font-semibold">
                  <Highlight text={term.term} query={query} />
                </dt>
                <dd className="mt-1 text-sm text-[var(--text-muted)]">
                  <Highlight text={term.definition} query={query} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </section>
  );
}
