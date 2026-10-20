'use client';

import { useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Zap } from 'lucide-react';
import { BATTLE_CODE_RE } from '@syntara/shared';
import { Button, Card, CodeInput, EmptyState, Skeleton } from '@syntara/ui';
import { useRouter } from '@/i18n/navigation';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { formatDateTime } from '@/lib/datetime';
import { AppLink } from '../app-link';

type History = components['schemas']['BattleStudentHistoryDto'];

/** Ширина страниц Battle ученика. */
export const STUDENT_BATTLE_WIDTH = 'max-w-[760px]';

/**
 * Ввод кода Battle (BT-S01 и карточка на главной ученика): `CodeInput` и «Войти в игру» → API-BTL-40 → лобби.
 * Ошибки: «Код не найден — проверь буквы и цифры», «Игра уже началась», «Учитель удалил тебя из этой игры».
 */
export function BattleJoinForm({ large = false }: { large?: boolean }) {
  const t = useTranslations('battle.student');
  const locale = useLocale();
  const router = useRouter();
  const errorId = useId();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function join(value = code) {
    if (!BATTLE_CODE_RE.test(value)) return setError(t('errors.codeNotFound'));
    setBusy(true);
    setError(null);
    const res = await apiRequest<{ sessionId: string }>('/api/student/battles/join', {
      method: 'POST',
      body: { code: value },
      locale,
    });
    setBusy(false);
    if (res.kind === 'ok') return router.push(`/learn/battles/${res.data.sessionId}`);
    if (res.kind !== 'http') return setError(t('errors.network'));
    if (res.status === 429)
      return setError(t('errors.rateLimited', { seconds: res.error.retryAfterSeconds ?? 60 }));
    const key = res.error.fieldErrors?.battle;
    setError(
      t(
        key === 'alreadyStarted' || key === 'kicked' || key === 'full'
          ? `errors.${key}`
          : 'errors.codeNotFound',
      ),
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      data-testid="battle-join"
      onSubmit={(e) => {
        e.preventDefault();
        void join();
      }}
    >
      <CodeInput
        value={code}
        onChange={(v) => {
          setCode(v);
          setError(null);
        }}
        label={t('join.codeLabel')}
        cellLabel={(i) => t('join.cell', { n: i + 1 })}
        invalid={Boolean(error)}
        describedBy={error ? errorId : undefined}
        large={large}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-[var(--danger-text)]">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary-blue" disabled={busy} className="self-start">
        {t('join.submit')}
      </Button>
    </form>
  );
}

/** Карточка на главной ученика (8.6.2): «Есть код Battle? Введи его». */
export function BattleHomeCard() {
  const t = useTranslations('battle.student');
  return (
    <Card className="mt-10 flex max-w-[520px] flex-col gap-4 p-5" data-testid="home-battle">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Zap aria-hidden="true" className="size-5 text-[var(--accent)]" />
        {t('home.title')}
      </h2>
      <BattleJoinForm />
    </Card>
  );
}

/** BT-S01 «Вход в Battle» (/learn/battles): код и «Мои Battle» — история (API-BTL-45). */
export function StudentBattles({ timeZone }: { timeZone: string }) {
  const t = useTranslations('battle.student');
  const locale = useLocale();
  const history = useQuery({
    queryKey: ['student', 'battles', 'history'],
    queryFn: async () => {
      const res = await apiRequest<History>('/api/student/battle-sessions?limit=50', { locale });
      if (res.kind !== 'ok') throw new Error('history');
      return res.data;
    },
  });
  return (
    <section
      className={`mx-auto flex ${STUDENT_BATTLE_WIDTH} flex-col gap-8 px-4 py-8`}
      data-testid="student-battles"
    >
      <h1 className="text-cabinet-title font-bold">{t('join.title')}</h1>
      <Card className="flex flex-col gap-4 p-5 sm:p-8">
        <BattleJoinForm large />
      </Card>
      <section aria-labelledby="battle-history" className="flex flex-col gap-3">
        <h2 id="battle-history" className="text-cabinet-block font-semibold">
          {t('history.title')}
        </h2>
        {history.isPending ? <Skeleton className="h-20" /> : null}
        {history.data?.items.length === 0 ? <EmptyState title={t('history.empty')} /> : null}
        <ul className="flex flex-col gap-3">
          {history.data?.items.map((item) => (
            <li key={item.id}>
              <Card className="flex flex-wrap items-center gap-4 p-4" data-testid="battle-history-item">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-semibold [overflow-wrap:anywhere]">{item.battleTitle}</span>
                  <span className="text-sm text-[var(--text-muted)]">
                    {formatDateTime(item.finishedAt, timeZone)} · {item.teacherName}
                  </span>
                </div>
                <div className="flex flex-col text-sm sm:text-right">
                  <span>{t('history.place', { rank: item.rank ?? '—', total: item.participantsCount })}</span>
                  <span className="text-[var(--text-muted)]">
                    {t('history.correct', { correct: item.correctCount ?? 0, total: item.questionsCount })}
                  </span>
                </div>
                <AppLink
                  href={`/learn/battles/${item.id}/results`}
                  className="inline-flex min-h-11 items-center rounded-[var(--radius-pill)] border border-[var(--border)] px-4 text-sm font-semibold hover:border-[var(--border-strong)] hover:bg-[var(--field)]"
                >
                  {t('history.open')}
                </AppLink>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
