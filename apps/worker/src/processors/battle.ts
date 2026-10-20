import { type Job, type Queue } from 'bullmq';
import { type Logger } from 'pino';
import { type Database } from '@syntara/db';
import {
  battleChannel,
  type BattleTimer,
  battleTimerJob,
  expireSessions,
  runBattleTimer,
  type TransitionResult,
} from '@syntara/db/battle';

export interface BattleDeps {
  db: Database;
  /** Redis PUBLISH — события доходят до всех экземпляров api (BATTLE_TZ 6.4). */
  publish: (channel: string, message: string) => Promise<unknown>;
  queue: Pick<Queue, 'add'>;
  logger: Logger;
}

/**
 * Очередь battle (BR-BTL-08, BATTLE_TZ 6.2): таймер закрытия вопроса (дедлайн + 500 мс) и автопереход вызывают
 * тот же идемпотентный переход SM-BTL, что и api; раз в минуту — истечение сессий (BR-BTL-06).
 * Изменившееся состояние публикуется в Redis, следующие таймеры ставятся в ту же очередь.
 */
export async function processBattleJob(job: Job, deps: BattleDeps): Promise<{ changed: number }> {
  const results: TransitionResult[] =
    job.name === 'expire'
      ? await expireSessions(deps.db)
      : [await runBattleTimer(deps.db, job.data as BattleTimer)];
  let changed = 0;
  for (const result of results) {
    if (!result.changed) continue;
    changed += 1;
    for (const event of result.events)
      await deps.publish(battleChannel(event.sessionId), JSON.stringify(event));
    for (const timer of result.timers) {
      const next = battleTimerJob(timer);
      await deps.queue.add(next.name, next.data, next.opts);
    }
  }
  if (changed) deps.logger.info({ job: job.name, changed }, 'battle transition');
  return { changed };
}
