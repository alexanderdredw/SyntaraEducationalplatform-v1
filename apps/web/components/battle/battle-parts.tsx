'use client';

import { useTranslations } from 'next-intl';
import { type BattleFinalView, type BattleLeaderboardView } from '@syntara/shared';
import { LeaderboardTable, Podium } from '@syntara/ui';

/** Время в секундах с одной цифрой после запятой («12,4 с»). */
export function useBattleTime() {
  const t = useTranslations('battle.common');
  return (ms: number) => t('seconds', { seconds: (ms / 1000).toFixed(1).replace('.', ',') });
}

/** Пьедестал и таблица остальных мест (BT-T08, BT-S06; BR-BTL-04). */
export function BattleFinal({ final, showMe = false }: { final: BattleFinalView; showMe?: boolean }) {
  const t = useTranslations('battle.common');
  const time = useBattleTime();
  const rest = final.table.filter((r) => r.rank > 3);
  return (
    <div className="flex flex-col gap-6">
      <Podium
        rows={final.podium}
        label={t('podium')}
        placeLabel={(rank) => t('place', { rank })}
        scoreLabel={(r) =>
          t('score', { correct: r.correctCount, total: final.questionsCount, time: time(r.correctTimeMs) })
        }
        meLabel={showMe ? t('me') : undefined}
      />
      {(showMe ? final.table : rest).length ? (
        <LeaderboardTable
          rows={showMe ? final.table : rest}
          caption={t('table')}
          columns={{
            rank: t('cols.rank'),
            name: t('cols.name'),
            correct: t('cols.correct'),
            time: t('cols.time'),
          }}
          timeLabel={time}
          meLabel={showMe ? t('me') : undefined}
        />
      ) : null}
    </div>
  );
}

/** Промежуточный рейтинг — топ-5 (BT-T07, BT-S05). */
export function BattleTop({ board }: { board: BattleLeaderboardView }) {
  const t = useTranslations('battle.common');
  return (
    <LeaderboardTable
      rows={board.top}
      caption={t('top')}
      columns={{ rank: t('cols.rank'), name: t('cols.name'), correct: t('cols.correct') }}
    />
  );
}
