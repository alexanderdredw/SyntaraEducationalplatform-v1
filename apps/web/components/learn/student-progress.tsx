'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { PROGRESS_PERIODS, type ProgressPeriod } from '@syntara/shared';
import { Button, Card, Modal, SegmentedControl, Skeleton } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { formatDateTime } from '@/lib/datetime';
import { AppLink } from '../app-link';

type Progress = components['schemas']['ProgressDto'];

/** YYYY-MM-DD → DD.MM.YYYY (PH-31). */
const day = (iso: string) => iso.split('-').reverse().join('.');

/**
 * «Мои показатели» (8.4.6, U08, API-S-14): период (REQ-ST-PRG-01, BR-ST-04; «Четверть» неактивна, пока даты
 * четвертей не заданы — Q-23), «Начни отсюда» (REQ-ST-PRG-02, BR-ST-06), «Мой прогресс» и «Серия» с окнами правил
 * (REQ-ST-PRG-03). Смена периода пересчитывает всё (REQ-ST-PRG-04, AC-ST-08).
 */
export function StudentProgress({ timeZone }: { timeZone: string }) {
  const t = useTranslations('student.progress');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [period, setPeriod] = useState<ProgressPeriod>('30d');
  const [help, setHelp] = useState<
    null | 'progressMeaning' | 'progressCounted' | 'streakMeaning' | 'streakCounted'
  >(null);
  const data = useQuery({
    queryKey: ['student', 'progress', period, locale],
    queryFn: async () => {
      const res = await apiRequest<Progress>(`/api/student/progress?period=${period}`, { locale });
      if (res.kind !== 'ok') throw new Error('progress');
      return res.data;
    },
    placeholderData: keepPreviousData,
  });
  const p = data.data;
  const available = p?.availablePeriods ?? PROGRESS_PERIODS.filter((x) => x !== 'quarter');
  const signed = (value: number, unit: string) => ({
    sign: value > 0 ? '+' : value < 0 ? '−' : '',
    value: `${Math.abs(value)}${unit}`,
  });
  const helpButtons = (
    meaning: 'progressMeaning' | 'streakMeaning',
    counted: 'progressCounted' | 'streakCounted',
  ) => (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => setHelp(meaning)}>
        {t('meaning')}
      </Button>
      <Button variant="secondary" onClick={() => setHelp(counted)}>
        {t('howCounted')}
      </Button>
    </div>
  );

  return (
    <section className="mx-auto flex max-w-[1000px] flex-col gap-6 px-4 py-8" data-testid="student-progress">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">{t('label')}</p>
          <h1 className="text-cabinet-title font-bold">{t('title')}</h1>
          <p className="text-sm text-[var(--text-muted)]" data-testid="progress-subtitle">
            {t('subtitle')}
          </p>
        </div>
        <SegmentedControl
          label={t('label')}
          value={period}
          onValueChange={(v) => setPeriod(v as ProgressPeriod)}
          className="flex-wrap"
          options={PROGRESS_PERIODS.map((value) => ({
            value,
            label: t(`periods.${value}`),
            disabled: !available.includes(value),
            hint: available.includes(value) ? undefined : t('quarterHint'),
          }))}
        />
      </header>

      {!p ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <Card className="flex flex-wrap gap-x-6 gap-y-1 py-4 text-sm" data-testid="progress-range">
            <span>
              {t('range', { period: t(`periods.${p.period}`), from: day(p.range.from), to: day(p.range.to) })}
            </span>
            <span className="text-[var(--text-muted)]">
              {t('compare', { from: day(p.compareRange.from), to: day(p.compareRange.to) })}
            </span>
          </Card>

          {/* Эталон U08: пояснение перед следующим шагом (решение владельца 2026-10-17). */}
          <Card tone="accent" className="flex flex-col gap-1" data-testid="progress-intro">
            <h2 className="font-semibold">{t('intro.title')}</h2>
            <p className="text-sm text-[var(--text-muted)]">{t('intro.text')}</p>
          </Card>

          <Card tone="accent" className="flex flex-col gap-4" data-testid="progress-next-step">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
                {t('start.label')}
              </p>
              <h2 className="text-lg font-semibold">{t('start.title')}</h2>
            </div>
            <dl className="grid gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <dt className="text-sm text-[var(--text-muted)]">{t('start.what')}</dt>
                <dd data-testid="next-step-action" data-action={p.nextStep.action}>
                  {t(`actions.${p.nextStep.action}`, {
                    topic: p.nextStep.topicTitle ?? '',
                    due: p.nextStep.dueAt ? formatDateTime(p.nextStep.dueAt, timeZone) : '',
                  })}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-sm text-[var(--text-muted)]">{t('start.why')}</dt>
                <dd>{t(`reasons.${p.nextStep.reason}`, { percent: p.nextStep.percent ?? 0 })}</dd>
              </div>
            </dl>
            <div>
              <Button asChild>
                <AppLink href={p.nextStep.href} data-testid="next-step-go">
                  {t('go')}
                </AppLink>
              </Button>
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="flex flex-col gap-3" data-testid="progress-card">
              <h2 className="text-lg font-semibold">{t('progressTitle')}</h2>
              <p className="text-cabinet-title font-bold" data-testid="progress-percent">
                {t('percent', { percent: p.progress.percent })}
              </p>
              <p className="text-sm text-[var(--text-muted)]" data-testid="progress-value">
                {t('progressValue', { mastered: p.progress.mastered, total: p.progress.total })}
              </p>
              <p className="text-sm text-[var(--text-muted)]" data-testid="progress-delta">
                {t('delta', signed(p.progress.deltaPercent, ' %'))}
              </p>
              {helpButtons('progressMeaning', 'progressCounted')}
            </Card>
            <Card className="flex flex-col gap-3" data-testid="streak-card">
              <h2 className="text-lg font-semibold">{t('streakTitle')}</h2>
              <p className="text-cabinet-title font-bold" data-testid="streak-days">
                {t('streakValue', { days: p.streak.days })}
              </p>
              <p className="text-sm text-[var(--text-muted)]">
                {p.streak.lastActivityDate
                  ? t('lastActivity', { date: day(p.streak.lastActivityDate) })
                  : t('noActivity')}
              </p>
              <p className="text-sm text-[var(--text-muted)]" data-testid="streak-delta">
                {t('delta', signed(p.streak.delta, ''))}
              </p>
              {helpButtons('streakMeaning', 'streakCounted')}
            </Card>
          </div>
        </>
      )}

      <Modal
        open={help !== null}
        onOpenChange={(open) => !open && setHelp(null)}
        title={help === 'progressMeaning' || help === 'streakMeaning' ? t('meaning') : t('howCounted')}
        closeLabel={tc('close')}
      >
        {help ? (
          <p className="mt-4 text-sm" data-testid="progress-help">
            {t(`help.${help}`)}
          </p>
        ) : null}
      </Modal>
    </section>
  );
}
