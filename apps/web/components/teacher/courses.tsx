'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Plus } from 'lucide-react';
import { Button, EmptyState, Skeleton } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { AppLink } from '../app-link';
import { CABINET_FORM_WIDTH, PageHeader, StatusPill } from './parts';

type Subject = components['schemas']['SubjectSummaryDto'];

/** «Мои курсы» (API-T-01, минимальная версия PH-24): предметы учителя и вход в «Новый предмет». */
export function TeacherCourses() {
  const t = useTranslations('teacher.courses');
  const locale = useLocale();
  const subjects = useQuery({
    queryKey: ['teacher', 'subjects', locale],
    queryFn: async () => {
      const res = await apiRequest<Subject[]>('/api/teacher/subjects', { locale });
      if (res.kind !== 'ok') throw new Error('subjects');
      return res.data;
    },
  });
  return (
    <section
      className={`mx-auto flex ${CABINET_FORM_WIDTH} flex-col gap-6 px-4 py-8`}
      data-testid="teacher-courses"
    >
      <PageHeader title={t('title')}>
        <Button asChild>
          <AppLink href="/teacher/subjects/new">
            <Plus aria-hidden="true" className="size-4" />
            {t('newSubject')}
          </AppLink>
        </Button>
      </PageHeader>
      {subjects.isPending ? <Skeleton className="h-24" /> : null}
      {subjects.data?.length === 0 ? (
        <EmptyState icon={<BookOpen className="size-6" />} title={t('empty')} />
      ) : null}
      <ul className="flex flex-col gap-3">
        {subjects.data?.map((s) => (
          <li key={s.id}>
            <AppLink
              href={`/teacher/subjects/${s.id}`}
              data-testid="teacher-subject"
              className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-card hover:border-[var(--border-strong)]"
            >
              <span className="flex flex-col gap-1">
                <span className="font-semibold" lang={s.locale}>
                  {s.title}
                </span>
                <span className="text-sm text-[var(--text-muted)]">
                  {t('topics', { count: s.topicsCount })}
                </span>
              </span>
              {s.inPublicCatalog ? <StatusPill tone="accent">{t('inCatalog')}</StatusPill> : null}
            </AppLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
