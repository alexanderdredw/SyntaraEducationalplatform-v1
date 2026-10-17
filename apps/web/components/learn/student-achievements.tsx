'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Award, Flame, Lock } from 'lucide-react';
import { Card, Pill, ProgressBar, Skeleton } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';

type Achievements = components['schemas']['AchievementsDto'];

/**
 * «Достижения» (8.4.7, U10, API-S-15): карточка уровня (REQ-ST-ACH-01, BR-XP-03) и бейджи 4 колонками — полученные
 * цветные, закрытые серые с замком и «ЗАКРЫТО» (REQ-ST-ACH-02, BR-BDG-01). Картинок бейджей пока нет — значок.
 */
export function StudentAchievements() {
  const t = useTranslations('student.achievements');
  const locale = useLocale();
  const data = useQuery({
    queryKey: ['student', 'achievements', locale],
    queryFn: async () => {
      const res = await apiRequest<Achievements>('/api/student/achievements', { locale });
      if (res.kind !== 'ok') throw new Error('achievements');
      return res.data;
    },
  });
  const a = data.data;
  return (
    <section
      className="mx-auto flex max-w-[760px] flex-col gap-6 px-4 py-8"
      data-testid="student-achievements"
    >
      <h1 className="text-cabinet-title font-bold">{t('title')}</h1>
      {!a ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <Card className="flex flex-col gap-4" data-testid="level-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-4">
                <span className="inline-flex size-12 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--accent-strong)] text-lg font-bold text-white">
                  {a.level}
                </span>
                <div>
                  <p className="text-lg font-semibold" data-testid="rank-title">
                    {a.rankTitle}
                  </p>
                  <p className="text-sm text-[var(--text-muted)]">{t('level', { level: a.level })}</p>
                </div>
              </div>
              <Pill data-testid="achievements-streak">
                <Flame aria-hidden="true" className="size-4 text-[var(--warning)]" />
                {t('streak', { days: a.streakDays })}
              </Pill>
            </div>
            <div className="flex flex-wrap justify-between gap-2 text-sm text-[var(--text-muted)]">
              <span data-testid="xp-total">{t('xpTotal', { xp: a.xpTotal })}</span>
              <span>{t('toNext', { xp: a.xpToNext })}</span>
            </div>
            <ProgressBar
              value={(100 * (a.xpPerLevel - a.xpToNext)) / a.xpPerLevel}
              label={t('levelProgress')}
            />
          </Card>

          <section className="flex flex-col gap-4" aria-labelledby="badges-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="badges-title" className="text-lg font-semibold">
                {t('badges')}
              </h2>
              <p className="text-sm text-[var(--text-muted)]" data-testid="badges-earned">
                {t('earned', { earned: a.earnedCount, total: a.totalCount })}
              </p>
            </div>
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {a.badges.map((b) => (
                <li key={b.code}>
                  <Card
                    tone={b.earned ? 'accent' : 'default'}
                    className="flex h-full flex-col items-center gap-2 p-4 text-center"
                    data-testid="badge"
                    data-earned={b.earned}
                  >
                    {b.imageUrl ? (
                      <img src={b.imageUrl} alt="" className="size-12" />
                    ) : (
                      <Award
                        aria-hidden="true"
                        className={
                          b.earned ? 'size-12 text-[var(--accent)]' : 'size-12 text-[var(--text-muted)]'
                        }
                      />
                    )}
                    <p className="font-semibold">{b.title}</p>
                    <p className="text-xs text-[var(--text-muted)]">{b.condition}</p>
                    {b.earned ? null : (
                      <p className="mt-auto inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
                        <Lock aria-hidden="true" className="size-3" />
                        {t('locked')}
                      </p>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </section>
  );
}
