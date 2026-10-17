'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Card,
  EmptyState,
  ProgressBar,
  progressTextTones,
  type ProgressTone,
  Skeleton,
} from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';

type Analytics = components['schemas']['ClassAnalyticsDto'];

const TONES: Record<'red' | 'blue' | 'green', ProgressTone> = {
  red: 'danger',
  blue: 'accent',
  green: 'success',
};

/**
 * «Аналитика класса» (8.3.7, T10, API-T-25): средняя успеваемость и вовлечённость (REQ-TCH-AN-02), слабые темы с
 * цветом по порогам PH-30 (REQ-TCH-AN-03, BR-AN-04), «Требуют внимания» (REQ-TCH-AN-04, BR-AN-05).
 * Учитываются и базовые уроки платформы, и личные уроки учителя.
 */
export function ClassAnalytics({ classId }: { classId: string }) {
  const t = useTranslations('teacher.analytics');
  const locale = useLocale();
  const data = useQuery({
    queryKey: ['teacher', 'analytics', classId, locale],
    queryFn: async () => {
      const res = await apiRequest<Analytics>(`/api/teacher/classes/${classId}/analytics`, { locale });
      if (res.kind !== 'ok') throw new Error('analytics');
      // «N дней назад» считается при загрузке, а не при отрисовке.
      const now = Date.now();
      return {
        ...res.data,
        attention: res.data.attention.map((a) => ({
          ...a,
          days: a.lastActivityAt
            ? Math.max(0, Math.floor((now - Date.parse(a.lastActivityAt)) / 86_400_000))
            : null,
        })),
      };
    },
  });
  if (!data.data) return <Skeleton className="h-64" />;
  const a = data.data;
  if (a.engagement.total === 0)
    return (
      <Card>
        <EmptyState title={t('noStudents')} />
      </Card>
    );

  return (
    <div className="flex flex-col gap-4" data-testid="class-analytics">
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col items-center gap-2 text-center" data-testid="analytics-avg">
          <p className="text-cabinet-title font-bold text-[var(--accent)]">{a.avgPercent}%</p>
          <p className="text-xs uppercase tracking-wider text-[var(--text-muted)]">{t('avg')}</p>
        </Card>
        <Card className="flex flex-col items-center gap-2 text-center" data-testid="analytics-engagement">
          <p className="text-cabinet-title font-bold">
            {a.engagement.active}/{a.engagement.total}
          </p>
          <p className="text-xs uppercase tracking-wider text-[var(--text-muted)]">{t('engagement')}</p>
          <p className="text-sm text-[var(--text-muted)]">{t('window', { days: a.engagement.windowDays })}</p>
        </Card>
      </div>

      <Card className="flex flex-col gap-4">
        <h2 className="font-semibold">{t('weak')}</h2>
        {a.weakTopics.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{t('weakEmpty')}</p>
        ) : null}
        <ul className="flex flex-col gap-4">
          {a.weakTopics.map((topic) => (
            <li
              key={topic.topicId}
              className="flex flex-col gap-2"
              data-testid="weak-topic"
              data-color={topic.color}
            >
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm">
                <span>{topic.title}</span>
                <span className="text-[var(--text-muted)]">{t('students', { count: topic.students })}</span>
                <span className={progressTextTones[TONES[topic.color]]}>{topic.percent}%</span>
              </div>
              <ProgressBar value={topic.percent} label={topic.title} tone={TONES[topic.color]} />
            </li>
          ))}
        </ul>
      </Card>

      <Card tone="danger" className="flex flex-col gap-4" data-testid="analytics-attention">
        <h2 className="font-semibold text-[var(--danger-text)]">{t('attention')}</h2>
        {a.attention.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{t('allActive')}</p>
        ) : null}
        <ul className="flex flex-col gap-2">
          {a.attention.map((s) => (
            <li
              key={s.studentId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-field)] border border-[var(--border)] px-4 py-3"
              data-testid="attention-student"
            >
              <span>{s.name}</span>
              <span className="flex items-center gap-3 text-sm text-[var(--text-muted)]">
                {s.days === null ? t('never') : t('daysAgo', { days: s.days })}
                <Badge tone="danger">{t('inactive')}</Badge>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
