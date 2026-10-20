'use client';

import { useEffect, useRef, useState } from 'react';

/** Типы событий SSE Battle (SPEC 6.9). */
export const BATTLE_EVENTS = [
  'snapshot',
  'participant_joined',
  'participant_left',
  'participant_kicked',
  'question_started',
  'answer_progress',
  'answer_accepted',
  'question_revealed',
  'leaderboard',
  'finished',
  'cancelled',
  'kicked',
] as const;
export type BattleEventType = (typeof BATTLE_EVENTS)[number];

export interface BattleStreamEvent {
  type: BattleEventType;
  /** Версия состояния из `id: {version}-{seq}` (BR-BTL-08). */
  version: number;
  data: Record<string, unknown>;
}

/** 6.9: переподключение с нарастающей задержкой 1, 2, 4, 8 с, не больше 10 с. */
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 10_000];
/** После 3 неудачных попыток — баннер «Нет соединения, переподключаемся…». */
const BANNER_AFTER = 3;

/**
 * Поток событий игры (API-BTL-22 / API-BTL-42): первым приходит `snapshot`, после обрыва — переподключение
 * и новый `snapshot`. `stop` — финальное состояние (игра закончена, отменена, участник выгнан): поток закрывается.
 */
export function useBattleStream(url: string, onEvent: (event: BattleStreamEvent) => void, stop: boolean) {
  const [lost, setLost] = useState(false);
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (stop) return;
    let source: EventSource | null = null;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const connect = () => {
      source = new EventSource(url, { withCredentials: true });
      source.onopen = () => {
        failures = 0;
        setLost(false);
      };
      for (const type of BATTLE_EVENTS) {
        source.addEventListener(type, (e) => {
          const message = e as MessageEvent<string>;
          const version = Number((message.lastEventId || '0').split('-')[0]);
          handler.current({ type, version, data: JSON.parse(message.data) as Record<string, unknown> });
        });
      }
      source.onerror = () => {
        source?.close();
        if (disposed) return;
        failures += 1;
        if (failures >= BANNER_AFTER) setLost(true);
        timer = setTimeout(connect, BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)]);
      };
    };
    connect();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      source?.close();
    };
  }, [url, stop]);

  return { lost: lost && !stop };
}

/** Поправка часов клиента: serverNow − Date.now() в момент получения (6.9). */
export const clockOffset = (serverNow: unknown) =>
  typeof serverNow === 'string' ? new Date(serverNow).getTime() - Date.now() : 0;
