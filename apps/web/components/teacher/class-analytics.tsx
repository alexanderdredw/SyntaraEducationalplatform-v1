'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import {
  Badge,
  Card,
  cn,
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
  const highlight = useSearchParams().get('student');
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
        <Card className="flex flex-col items-center gap-1.5 py-6 text-center" data-testid="analytics-avg">
          <p className="text-2xl font-bold text-[var(--accent-bright)]">{a.avgPercent}%</p>
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">{t('avg')}</p>
        </Card>
        <Card
          className="flex flex-col items-center gap-1.5 py-6 text-center"
          data-testid="analytics-engagement"
        >
          <p className="text-2xl font-bold">
            {a.engagement.active}/{a.engagement.total}
          </p>
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">{t('engagement')}</p>
          <p className="text-xs text-[var(--text-muted)]">{t('window', { days: a.engagement.windowDays })}</p>
        </Card>
      </div>

      <Card className="flex flex-col gap-4">
        <h2 className="text-sm font-bold">{t('weak')}</h2>
        {a.weakTopics.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{t('weakEmpty')}</p>
        ) : null}
        <ul className="flex flex-col gap-3">
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
        <h2 className="text-sm font-bold text-[var(--danger-text)]">{t('attention')}</h2>
        {a.attention.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{t('allActive')}</p>
        ) : null}
        <ul className="flex flex-col gap-2">
          {a.attention.map((s) => (
            <li
              key={s.studentId}
              // REQ-PRF-25: переход из «Обзора» учителя (?student=…) — ученик подсвечен.
              className={cn(
                'flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-field)] border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--danger)_7%,transparent)] px-3 py-2',
                highlight === s.studentId && 'ring-2 ring-[var(--accent)]',
              )}
              data-testid="attention-student"
              data-highlighted={highlight === s.studentId ? 'true' : undefined}
              aria-current={highlight === s.studentId ? 'true' : undefined}
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
