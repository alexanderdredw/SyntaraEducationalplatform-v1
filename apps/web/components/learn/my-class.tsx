'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { type NavSection } from '@syntara/shared';
import { Badge, Card, EmptyState, Pill, ProgressBar, Skeleton } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import { formatDateTime } from '@/lib/datetime';
import { AppLink } from '../app-link';
import { StudentClassCard } from '../cabinet/student-class-card';
import { NAV_BADGES_KEY, useClassOverview } from '../cabinet/nav-state';

/**
 * API-S-21: раздел открыт — отметка на сервере, точка «новое» в панели пропадает (REQ-NAV-14). Вызывается после
 * загрузки данных раздела, чтобы метки «Новое» на карточках посчитались по прошлому визиту.
 */
export function useMarkSectionSeen(section: NavSection, ready: boolean) {
  const queryClient = useQueryClient();
  const sent = useRef(false);
  useEffect(() => {
    if (!ready || sent.current) return;
    sent.current = true;
    void apiRequest('/api/student/nav-seen', { method: 'POST', body: { section } }).then(() =>
      queryClient.invalidateQueries({ queryKey: NAV_BADGES_KEY }),
    );
  }, [ready, section, queryClient]);
}

/**
 * «Мой класс» (/learn/class, REQ-NAV-11, API-S-19): карточка класса с выходом (BR-CLS-03), «Предметы от учителя»
 * с прогрессом и меткой «Новое», «Ближайшие задания». Без класса — «Подключиться к классу» и пояснение.
 */
export function MyClass({ timeZone }: { timeZone: string }) {
  const t = useTranslations('student.myClass');
  const ta = useTranslations('student.assignments');
  const overview = useClassOverview();
  useMarkSectionSeen('class', overview.isSuccess);
  const data = overview.data;

  return (
    <section className="mx-auto flex max-w-[1012px] flex-col gap-6 px-4 py-8" data-testid="my-class">
      <h1 className="text-cabinet-title font-bold">{t('title')}</h1>
      <StudentClassCard />
      {overview.isPending ? <Skeleton className="h-32" /> : null}
      {data && !data.class ? (
        <p className="text-[var(--text-muted)]" data-testid="my-class-join-hint">
          {t('joinHint')}
        </p>
      ) : null}
      {data?.class ? (
        <>
          <section aria-labelledby="my-class-subjects" className="flex flex-col gap-3">
            <h2 id="my-class-subjects" className="text-cabinet-block font-semibold">
              {t('subjects')}
            </h2>
            {data.subjects.length === 0 ? (
              <Card>
                <EmptyState title={t('subjectsEmpty')} />
              </Card>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2" data-testid="class-subjects">
                {data.subjects.map((s) => {
                  const progress = t('progress', { mastered: s.topicsMastered, total: s.topicsTotal });
                  return (
                    <li key={s.id}>
                      <AppLink
                        href={`/learn/subjects/${s.id}`}
                        data-testid="class-subject"
                        data-new={s.isNew}
                        className="flex h-full flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-6 py-5 hover:border-[var(--border-strong)]"
                      >
                        <span className="flex items-start justify-between gap-3">
                          {/* Пользовательские названия не переводятся (REQ-ST-CAT-02). */}
                          <span className="text-cabinet-block font-semibold">{s.title}</span>
                          {s.isNew ? <Pill className="shrink-0">{t('new')}</Pill> : null}
                        </span>
                        {s.description ? (
                          <span className="text-sm text-[var(--text-muted)]">{s.description}</span>
                        ) : null}
                        <span className="mt-auto flex flex-col gap-1.5">
                          <span className="text-sm">{progress}</span>
                          <ProgressBar
                            value={s.topicsTotal ? (s.topicsMastered / s.topicsTotal) * 100 : 0}
                            label={progress}
                          />
                        </span>
                      </AppLink>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="my-class-upcoming" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="my-class-upcoming" className="text-cabinet-block font-semibold">
                {t('upcoming')}
              </h2>
              <AppLink
                href="/learn/assignments"
                className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--accent)] hover:underline"
              >
                {t('allAssignments')}
              </AppLink>
            </div>
            {data.upcomingAssignments.length === 0 ? (
              <p className="text-[var(--text-muted)]">{t('noAssignments')}</p>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="class-upcoming">
                {data.upcomingAssignments.map((a) => (
                  <li key={a.id}>
                    <AppLink
                      href={`/learn/topics/${a.topicId}?tab=quiz&assignment=${a.id}`}
                      data-testid="class-upcoming-item"
                      className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 hover:border-[var(--border-strong)]"
                    >
                      <span className="flex flex-col gap-1">
                        <span className="font-semibold">{a.topicTitle}</span>
                        <span className="text-sm text-[var(--text-muted)]">
                          {a.subjectTitle} · {ta('due', { due: formatDateTime(a.dueAt, timeZone) })}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        {a.overdue ? <Badge tone="danger">{ta('overdue')}</Badge> : null}
                        <Badge tone="neutral">{ta(`status.${a.status}`)}</Badge>
                      </span>
                    </AppLink>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}
