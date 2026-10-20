'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { type BattleResults } from '@syntara/shared';
import {
  AnswerMarker,
  Button,
  Card,
  cn,
  EmptyState,
  ProgressBar,
  type ProgressTone,
  Skeleton,
} from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { formatDateTime } from '@/lib/datetime';
import { AppLink } from '../app-link';
import { BattleFinal, useBattleTime } from './battle-parts';
import { BATTLE_PAGE_WIDTH } from './teacher-battles';

type History = components['schemas']['BattleHistoryDto'];

/** Пороги аналитики PH-30: < 50 — красный, 50–79 — синий, ≥ 80 — зелёный (BR-AN-04). */
const tone = (percent: number): ProgressTone =>
  percent < 50 ? 'danger' : percent < 80 ? 'accent' : 'success';

const linkClass =
  'inline-flex min-h-11 items-center rounded-[var(--radius-pill)] border border-[var(--border)] px-4 text-sm font-semibold hover:border-[var(--border-strong)] hover:bg-[var(--field)]';

/** Вкладка «История игр» (BT-T01, API-BTL-29); класс показывается только у старых сессий, где он был выбран. */
export function TeacherBattleHistory({ timeZone }: { timeZone: string }) {
  const t = useTranslations('battle.teacher.history');
  const locale = useLocale();
  const history = useInfiniteQuery({
    queryKey: ['teacher', 'battle-history'],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '20' });
      if (pageParam) params.set('cursor', pageParam);
      const res = await apiRequest<History>(`/api/teacher/battle-sessions?${params}`, { locale });
      if (res.kind !== 'ok') throw new Error('history');
      return res.data;
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="flex flex-col gap-3" data-testid="battle-history">
      {history.isPending ? <Skeleton className="h-24" /> : null}
      {!history.isPending && items.length === 0 ? <EmptyState title={t('empty')} /> : null}
      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          const active = item.status === 'lobby' || item.status === 'in_progress';
          return (
            <li key={item.id}>
              <Card className="flex flex-wrap items-center gap-4 p-4" data-testid="battle-history-item">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-semibold [overflow-wrap:anywhere]">{item.battleTitle}</span>
                  <span className="text-sm text-[var(--text-muted)]">
                    {[
                      item.className,
                      item.startedAt ? formatDateTime(item.startedAt, timeZone) : null,
                      t('participants', { count: item.participantsCount }),
                      t(`status.${item.status}`),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                <AppLink
                  href={
                    active
                      ? `/teacher/battle-sessions/${item.id}`
                      : `/teacher/battle-sessions/${item.id}/results`
                  }
                  className={linkClass}
                >
                  {active ? t('open') : t('results')}
                </AppLink>
              </Card>
            </li>
          );
        })}
      </ul>
      {history.hasNextPage ? (
        <Button variant="secondary" className="self-start" onClick={() => void history.fetchNextPage()}>
          {t('more')}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * BT-T09 «Результаты игры» (/teacher/battle-sessions/:sid/results, API-BTL-30): шапка, пьедестал и таблица,
 * «По вопросам» (доля правильных — цвет по порогам аналитики, распределение, среднее время), «Сложные вопросы»,
 * «По ученикам» — строка раскрывается ответами по вопросам; экспорт CSV (API-BTL-31).
 */
export function TeacherBattleResults({ sessionId, timeZone }: { sessionId: string; timeZone: string }) {
  const t = useTranslations('battle.teacher.results');
  const locale = useLocale();
  const time = useBattleTime();
  const results = useQuery({
    queryKey: ['teacher', 'battle-results', sessionId],
    queryFn: async () => {
      const res = await apiRequest<BattleResults>(`/api/teacher/battle-sessions/${sessionId}/results`, {
        locale,
      });
      if (res.kind !== 'ok') throw new Error('results');
      return res.data;
    },
  });
  const data = results.data;
  return (
    <section
      className={`mx-auto flex ${BATTLE_PAGE_WIDTH} flex-col gap-8 px-4 py-8`}
      data-testid="battle-results"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-cabinet-title font-bold">{t('title')}</h1>
        <AppLink
          href="/teacher/battles?tab=history"
          className="inline-flex min-h-11 items-center text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          {t('back')}
        </AppLink>
      </div>
      {results.isPending ? <Skeleton className="h-64" /> : null}
      {data ? (
        <>
          <Card className="flex flex-wrap items-center gap-4 p-5">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-lg font-semibold [overflow-wrap:anywhere]">
                {data.session.battleTitle}
              </span>
              <span className="text-sm text-[var(--text-muted)]">
                {[
                  data.session.className,
                  data.session.startedAt ? formatDateTime(data.session.startedAt, timeZone) : null,
                  t('participants', { count: data.session.participantsCount }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <a href={`/api/teacher/battle-sessions/${sessionId}/results.csv`} className={linkClass}>
              {t('csv')}
            </a>
          </Card>

          <BattleFinal
            final={{ podium: data.podium, table: data.table, questionsCount: data.session.questionsCount }}
          />

          <section aria-labelledby="by-question" className="flex flex-col gap-3">
            <h2 id="by-question" className="text-cabinet-block font-semibold">
              {t('byQuestion')}
            </h2>
            {data.hardQuestions.length ? (
              <Card className="flex flex-col gap-2 border-[var(--danger)] p-4" data-testid="battle-hard">
                <h3 className="font-semibold">{t('hard')}</h3>
                <ul className="flex flex-col gap-1 text-sm">
                  {data.hardQuestions.map((index) => {
                    const q = data.questions.find((x) => x.index === index)!;
                    return (
                      <li key={index}>
                        {t('question', { number: index + 1 })}. {q.text} — {q.correctPercent} %
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ) : null}
            <ol className="flex flex-col gap-3">
              {data.questions.map((q) => (
                <li key={q.index}>
                  <Card className="flex flex-col gap-3 p-5" data-testid="battle-question-stat">
                    <span className="font-semibold [overflow-wrap:anywhere]">
                      {t('question', { number: q.index + 1 })}. {q.text}
                    </span>
                    {q.correctPercent !== null ? (
                      <div className="flex items-center gap-3">
                        <ProgressBar
                          value={q.correctPercent}
                          tone={tone(q.correctPercent)}
                          label={t('correctShare', { percent: q.correctPercent })}
                          className="flex-1"
                        />
                        <span className="text-sm font-semibold tabular-nums">{q.correctPercent} %</span>
                      </div>
                    ) : (
                      <span className="text-sm text-[var(--text-muted)]">{t('noAnswers')}</span>
                    )}
                    <ul className="flex flex-wrap gap-3 text-sm">
                      {q.distribution.map((d) => (
                        <li
                          key={d.position}
                          className={cn(
                            'flex items-center gap-2',
                            d.position === q.correctPosition && 'font-bold',
                          )}
                        >
                          <AnswerMarker position={d.position} />
                          <span>
                            {q.options.find((o) => o.position === d.position)?.text} — {d.count}
                            {d.position === q.correctPosition ? ` (${t('correct')})` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <span className="text-sm text-[var(--text-muted)]">
                      {t('answered', { count: q.answered })}
                      {q.avgResponseMs !== null ? ` · ${t('avgTime', { time: time(q.avgResponseMs) })}` : ''}
                    </span>
                  </Card>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="by-student" className="flex flex-col gap-3">
            <h2 id="by-student" className="text-cabinet-block font-semibold">
              {t('byStudent')}
            </h2>
            <ul className="flex flex-col gap-2">
              {data.students.map((s, i) => (
                <li key={`${s.displayName}-${i}`}>
                  <details
                    className="rounded-[var(--radius-card)] border border-[var(--border)]"
                    data-testid="battle-student-row"
                  >
                    <summary className="flex min-h-12 cursor-pointer items-center gap-3 px-4 font-semibold">
                      <span className="tabular-nums">{s.rank}</span>
                      <span className="flex-1 [overflow-wrap:anywhere]">{s.displayName}</span>
                      <span className="text-sm text-[var(--text-muted)]">
                        {t('studentScore', {
                          correct: s.answers.filter((a) => a.isCorrect).length,
                          total: data.session.questionsCount,
                        })}
                      </span>
                    </summary>
                    <ol className="flex flex-col gap-2 border-t border-[var(--border)] px-4 py-3 text-sm">
                      {s.answers.map((a) => (
                        <li key={a.index} className="flex flex-wrap items-center gap-2">
                          <span className="text-[var(--text-muted)]">
                            {t('question', { number: a.index + 1 })}:
                          </span>
                          {a.optionPosition ? <AnswerMarker position={a.optionPosition} /> : t('noAnswer')}
                          <span
                            className={
                              a.isCorrect ? 'text-[var(--success-text)]' : 'text-[var(--danger-text)]'
                            }
                          >
                            {a.isCorrect ? t('correct') : t('wrong')}
                          </span>
                          {a.responseMs !== null ? (
                            <span className="text-[var(--text-muted)]">{time(a.responseMs)}</span>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  </details>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </section>
  );
}
