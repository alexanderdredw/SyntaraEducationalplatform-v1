import {
  BATTLE_PODIUM_MAX_RANK,
  type BattleFinalView,
  type BattleHostReveal,
  type BattleLeaderboardView,
  type BattleRow,
  type BattleStudentReveal,
} from '@syntara/shared';
import { BATTLE_TOP, type Standing } from '@syntara/db/battle';

/**
 * Представления состояния игры для ведущего и ученика (SPEC 6.8–6.9): одно и то же для снимка (API-BTL-21/41)
 * и событий SSE. Правильность чужих ответов ученику не попадает; у ученика — только своё место и свой результат.
 */

export const toRows = (table: Standing[], meParticipantId?: string | null): BattleRow[] =>
  table.map((s) => ({
    rank: s.rank,
    displayName: s.displayName,
    correctCount: s.correctCount,
    correctTimeMs: s.correctTimeMs,
    answeredCount: s.answeredCount,
    ...(meParticipantId !== undefined ? { me: s.participantId === meParticipantId } : {}),
  }));

export function finalView(table: Standing[], questionsCount: number, me?: string | null): BattleFinalView {
  const rows = toRows(table, me);
  return {
    podium: rows.filter((r) => r.rank <= BATTLE_PODIUM_MAX_RANK),
    table: rows,
    questionsCount,
    ...(me !== undefined ? { me: rows.find((r) => r.me) ?? null } : {}),
  };
}

export function leaderboardView(index: number, table: Standing[], me?: string | null): BattleLeaderboardView {
  const mine = me ? table.find((s) => s.participantId === me) : undefined;
  return {
    index,
    top: table
      .slice(0, BATTLE_TOP)
      .map((s) => ({ rank: s.rank, displayName: s.displayName, correctCount: s.correctCount })),
    ...(me !== undefined ? { me: mine ? { rank: mine.rank, correctCount: mine.correctCount } : null } : {}),
  };
}

export interface RevealData {
  index: number;
  correctPosition: number;
  distribution: Array<{ position: number; count: number }>;
  avgResponseMs: number | null;
  answers: Record<string, number>;
  standings: Standing[];
}

export const hostReveal = (d: RevealData): BattleHostReveal => ({
  index: d.index,
  correctPosition: d.correctPosition,
  distribution: d.distribution,
  avgResponseMs: d.avgResponseMs,
});

export function studentReveal(d: RevealData, participantId: string): BattleStudentReveal {
  const myPosition = d.answers[participantId] ?? null;
  const mine = d.standings.find((s) => s.participantId === participantId);
  return {
    index: d.index,
    correctPosition: d.correctPosition,
    myPosition,
    isCorrect: myPosition === d.correctPosition,
    myCorrectCount: mine?.correctCount ?? 0,
    myRank: mine?.rank ?? null,
    participantsCount: d.standings.length,
  };
}
