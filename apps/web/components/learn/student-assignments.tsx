'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, EmptyState, Skeleton } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { formatDateTime } from '@/lib/datetime';
import { AppLink } from '../app-link';

type Assignment = components['schemas']['StudentAssignmentDto'];

/**
 * «Мои задания» (8.4.8, REQ-ST-ASG-01, PH-33, API-S-10): тема, предмет, срок, статус «Не начато» / «Сдано» /
 * «Оценено: {grade}%», просроченные — «Срок прошёл». Карточка открывает квиз темы с заданием (Q-18).
 */
export function StudentAssignments({ timeZone }: { timeZone: string }) {
  const t = useTranslations('student.assignments');
  const locale = useLocale();
  const list = useQuery({
    queryKey: ['student', 'assignments', locale],
    queryFn: async () => {
      const res = await apiRequest<Assignment[]>('/api/student/assignments', { locale });
      if (res.kind !== 'ok') throw new Error('assignments');
      return res.data;
    },
  });
  return (
    <section
      className="mx-auto flex max-w-[760px] flex-col gap-6 px-4 py-8"
      data-testid="student-assignments"
    >
      <h1 className="text-cabinet-title font-bold">{t('title')}</h1>
      {list.isPending ? <Skeleton className="h-24" /> : null}
      {list.data?.length === 0 ? (
        <Card>
          <EmptyState title={t('empty')} />
        </Card>
      ) : null}
      <ul className="flex flex-col gap-3">
        {list.data?.map((a) => (
          <li key={a.id}>
            <AppLink
              href={`/learn/topics/${a.topicId}?tab=quiz&assignment=${a.id}`}
              className="block rounded-[var(--radius-card)]"
              data-testid="student-assignment"
              data-status={a.status}
            >
              <Card className="flex flex-wrap items-center justify-between gap-3 hover:border-[var(--border-strong)]">
                <div className="flex flex-col gap-1">
                  <p className="font-semibold">{a.topicTitle}</p>
                  <p className="text-sm text-[var(--text-muted)]">
                    {a.subjectTitle} · {t('due', { due: formatDateTime(a.dueAt, timeZone) })}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {a.overdue ? <Badge tone="danger">{t('overdue')}</Badge> : null}
                  <Badge
                    tone={a.status === 'graded' ? 'success' : a.status === 'submitted' ? 'accent' : 'neutral'}
                  >
                    {a.status === 'graded'
                      ? t('status.graded', { grade: Math.round(a.grade ?? 0) })
                      : t(`status.${a.status}`)}
                  </Badge>
                </div>
              </Card>
            </AppLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
