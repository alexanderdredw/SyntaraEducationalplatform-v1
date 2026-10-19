'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers } from 'lucide-react';
import { type Locale, LOCALES } from '@syntara/shared';
import { Button, Card, EmptyState, Skeleton } from '@syntara/ui';
import { useRouter } from '@/i18n/navigation';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { AppLink } from '../app-link';
import { CABINET_FORM_WIDTH, PageHeader, StatusPill } from './parts';
import { emptySubject, SubjectForm, type SubjectValues } from './subject-form';

type Subject = components['schemas']['SubjectDetailDto'];
type TeacherClass = components['schemas']['TeacherClassDto'];

/** Название на языке интерфейса, иначе ru, en, kk (REQ-GEN-PREF-02). */
export function pickTitle(
  translations: Partial<Record<Locale, { title?: string | null }>>,
  locale: string,
): string {
  for (const l of [locale, 'ru', 'en', 'kk'] as Locale[]) {
    const title = translations[l]?.title;
    if (title) return title;
  }
  return '';
}

/**
 * Предмет (8.3.2, T04): правка предмета, «Выдать предмет классу» (API-T-07/08, REQ-TCH-ACC-01) и «Темы»
 * (API-T-09 → редактор, REQ-TCH-ACC-02).
 */
export function SubjectPage({ id }: { id: string }) {
  const t = useTranslations('teacher.subject');
  const tsf = useTranslations('teacher.subjectForm');
  const tf = useTranslations('forms');
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const key = ['teacher', 'subject', id, locale];

  const subject = useQuery({
    queryKey: key,
    queryFn: async () => {
      const res = await apiRequest<Subject>(`/api/teacher/subjects/${id}`, { locale });
      if (res.kind !== 'ok') throw new Error('subject');
      return res.data;
    },
  });
  const classes = useQuery({
    queryKey: ['teacher', 'classes'],
    queryFn: async () => {
      const res = await apiRequest<TeacherClass[]>('/api/teacher/classes', { locale });
      if (res.kind !== 'ok') throw new Error('classes');
      return res.data;
    },
  });

  async function access(classId: string, grant: boolean) {
    setBusy(classId);
    setFailed(false);
    const res = await apiRequest(
      grant ? `/api/teacher/subjects/${id}/access` : `/api/teacher/subjects/${id}/access/${classId}`,
      grant ? { method: 'POST', body: { classId }, locale } : { method: 'DELETE', locale },
    );
    if (res.kind !== 'ok') setFailed(true);
    await queryClient.invalidateQueries({ queryKey: key });
    setBusy(null);
  }

  async function addTopic() {
    setBusy('topic');
    setFailed(false);
    const res = await apiRequest<{ id: string }>(`/api/teacher/subjects/${id}/topics`, {
      method: 'POST',
      locale,
    });
    if (res.kind === 'ok') router.push(`/teacher/topics/${res.data.id}`);
    else {
      setFailed(true);
      setBusy(null);
    }
  }

  if (!subject.data) {
    return (
      <section className={`mx-auto ${CABINET_FORM_WIDTH} px-4 py-8`}>
        <Skeleton className="h-64" />
      </section>
    );
  }

  const data = subject.data;
  const initial: SubjectValues = emptySubject();
  for (const l of LOCALES) {
    const tr = data.translations[l];
    if (tr) initial.translations[l] = { title: tr.title ?? '', description: tr.description ?? '' };
  }
  initial.inPublicCatalog = data.inPublicCatalog;

  return (
    <section
      className={`mx-auto flex ${CABINET_FORM_WIDTH} flex-col gap-8 px-4 py-8`}
      data-testid="subject-page"
    >
      <PageHeader
        title={pickTitle(data.translations, locale)}
        back={{ href: '/teacher/courses', label: tsf('back') }}
      />
      <SubjectForm mode="edit" subjectId={id} initial={initial} />

      <section aria-labelledby="access-title" className="flex flex-col gap-3" data-testid="subject-access">
        <h2 id="access-title" className="text-cabinet-block font-semibold">
          {t('accessTitle')}
        </h2>
        <p className="text-sm text-[var(--text-muted)]">{t('accessHint')}</p>
        {classes.data?.length === 0 ? (
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <span className="text-sm">{t('noClasses')}</span>
            <Button asChild variant="secondary">
              <AppLink href="/teacher/classes">{t('toClasses')}</AppLink>
            </Button>
          </Card>
        ) : null}
        <ul className="flex flex-col gap-2">
          {classes.data?.map((cls) => {
            const granted = data.grantedClassIds.includes(cls.id);
            return (
              <li key={cls.id}>
                <Card
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] px-3 py-2.5"
                  data-testid="access-class"
                >
                  <span className="flex flex-col">
                    <span>{cls.name}</span>
                    <span className="text-xs text-[var(--text-muted)]">
                      {t('students', { count: cls.studentsCount })}
                    </span>
                  </span>
                  {granted ? (
                    <span className="flex items-center gap-2">
                      <StatusPill tone="success">{t('granted')}</StatusPill>
                      <Button
                        variant="quiet"
                        size="sm"
                        disabled={busy === cls.id}
                        onClick={() => void access(cls.id, false)}
                      >
                        {t('revoke')}
                      </Button>
                    </span>
                  ) : (
                    <Button size="sm" disabled={busy === cls.id} onClick={() => void access(cls.id, true)}>
                      {t('grant')}
                    </Button>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="topics-title" className="flex flex-col gap-3" data-testid="subject-topics">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="topics-title" className="text-cabinet-block font-semibold">
            {t('topicsTitle')}
          </h2>
          <Button variant="secondary" disabled={busy === 'topic'} onClick={() => void addTopic()}>
            {t('addTopic')}
          </Button>
        </div>
        {data.topics.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--border)]">
            <EmptyState icon={<Layers className="size-6" />} title={t('noTopics')} />
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.topics.map((topic) => (
              <li key={topic.id}>
                <AppLink
                  href={`/teacher/topics/${topic.id}`}
                  data-testid="subject-topic"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 hover:border-[var(--border-strong)]"
                >
                  <span className="flex flex-col">
                    <span className="text-xs text-[var(--text-muted)]">
                      {t('number', { number: topic.number })}
                    </span>
                    <span className="font-medium">{topic.title ?? t('untitled')}</span>
                  </span>
                  <StatusPill tone={topic.status === 'published' ? 'success' : 'neutral'}>
                    {t(`status.${topic.status}`)}
                  </StatusPill>
                </AppLink>
              </li>
            ))}
          </ul>
        )}
      </section>
      {failed ? (
        <p role="alert" className="text-sm text-[var(--danger-text)]">
          {tf('serverError')}
        </p>
      ) : null}
    </section>
  );
}
