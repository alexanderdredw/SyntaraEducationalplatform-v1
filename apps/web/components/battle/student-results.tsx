'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { type BattleResults } from '@syntara/shared';
import { AnswerMarker, Card, EmptyState, Skeleton } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import { AppLink } from '../app-link';
import { BattleFinal } from './battle-parts';
import { STUDENT_BATTLE_WIDTH } from './student-join';

/** Итоги игры ученика (/learn/battles/:sid/results, BT-S06, API-BTL-46): места и «Мои ответы» с правильными. */
export function StudentResults({ sessionId }: { sessionId: string }) {
  const t = useTranslations('battle.student');
  const locale = useLocale();
  const results = useQuery({
    queryKey: ['student', 'battle', sessionId, 'results'],
    queryFn: async () => {
      const res = await apiRequest<BattleResults>(`/api/student/battle-sessions/${sessionId}/results`, {
        locale,
      });
      if (res.kind !== 'ok')
        throw new Error(res.kind === 'http' ? (res.error.fieldErrors?.battle ?? 'results') : 'results');
      return res.data;
    },
    retry: false,
  });
  const data = results.data;
  const mine = data?.students[0];
  return (
    <section
      className={`mx-auto flex ${STUDENT_BATTLE_WIDTH} flex-col gap-6 px-4 py-8`}
      data-testid="student-results"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-cabinet-title font-bold">{t('results.title')}</h1>
        <AppLink
          href="/learn/battles"
          className="inline-flex min-h-11 items-center text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          {t('results.back')}
        </AppLink>
      </div>
      {results.isPending ? <Skeleton className="h-48" /> : null}
      {results.isError ? <EmptyState title={t('results.notFinished')} /> : null}
      {data ? (
        <>
          <p className="text-lg font-semibold [overflow-wrap:anywhere]">{data.session.battleTitle}</p>
          <BattleFinal
            final={{
              podium: data.podium,
              table: data.table,
              questionsCount: data.session.questionsCount,
              me: data.me ?? null,
            }}
            showMe
          />
          <section aria-labelledby="my-answers" className="flex flex-col gap-3">
            <h2 id="my-answers" className="text-cabinet-block font-semibold">
              {t('final.answers')}
            </h2>
            <ol className="flex flex-col gap-3">
              {data.questions.map((q) => {
                const a = mine?.answers.find((x) => x.index === q.index);
                const my = q.options.find((o) => o.position === a?.optionPosition);
                const right = q.options.find((o) => o.position === q.correctPosition)!;
                return (
                  <li key={q.index}>
                    <Card className="flex flex-col gap-3 p-5" data-testid="battle-my-answer">
                      <div className="flex items-start gap-2">
                        {a?.isCorrect ? (
                          <Check
                            aria-label={t('reveal.correct')}
                            className="mt-0.5 size-5 shrink-0 text-[var(--success-text)]"
                          />
                        ) : (
                          <X
                            aria-label={t('reveal.wrong')}
                            className="mt-0.5 size-5 shrink-0 text-[var(--danger-text)]"
                          />
                        )}
                        <span className="font-semibold [overflow-wrap:anywhere]">
                          {t('results.question', { number: q.index + 1 })}. {q.text}
                        </span>
                      </div>
                      <p className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-[var(--text-muted)]">{t('results.yourAnswer')}</span>
                        {my ? (
                          <>
                            <AnswerMarker position={my.position} />
                            {my.text}
                          </>
                        ) : (
                          t('results.noAnswer')
                        )}
                      </p>
                      {!a?.isCorrect ? (
                        <p className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="text-[var(--text-muted)]">{t('results.correctAnswer')}</span>
                          <AnswerMarker position={right.position} />
                          {right.text}
                        </p>
                      ) : null}
                    </Card>
                  </li>
                );
              })}
            </ol>
          </section>
        </>
      ) : null}
    </section>
  );
}
