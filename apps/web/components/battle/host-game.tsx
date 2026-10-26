'use client';

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Maximize2, Minimize2 } from 'lucide-react';
import {
  type BattleFinalView,
  type BattleHostReveal,
  type BattleHostSnapshot,
  type BattleLeaderboardView,
  type BattleParticipantView,
  type BattleQuestionView,
} from '@syntara/shared';
import {
  AnswerShape,
  AnswerTile,
  answerToneClass,
  ANSWER_LETTERS,
  BigCode,
  Button,
  Card,
  cn,
  ConnectionBanner,
  CountdownBar,
  Modal,
  ParticipantChip,
  Skeleton,
} from '@syntara/ui';
import { useRouter } from '@/i18n/navigation';
import { apiRequest } from '@/lib/api/browser';
import { AppLink } from '../app-link';
import { BattleFinal, BattleTop, useBattleTime } from './battle-parts';
import { createSession } from './launch-dialog';
import { type BattleStreamEvent, clockOffset, useBattleStream } from './use-battle-stream';

interface State {
  snap: BattleHostSnapshot | null;
  offsetMs: number;
}

type Action = BattleStreamEvent | { type: 'replace'; snap: BattleHostSnapshot };

const upsert = (list: BattleParticipantView[], p: BattleParticipantView) =>
  list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p];

/** События SSE ведущего (6.9) → снимок API-BTL-21; события со старой версией игнорируются (BR-BTL-08). */
function reduce(state: State, action: Action): State {
  if (action.type === 'replace' || action.type === 'snapshot') {
    const snap = action.type === 'replace' ? action.snap : (action.data as unknown as BattleHostSnapshot);
    if (state.snap && snap.version < state.snap.version) return state;
    return { snap, offsetMs: clockOffset(snap.serverNow) };
  }
  const snap = state.snap;
  if (!snap || action.version < snap.version) return state;
  const d = action.data;
  switch (action.type) {
    case 'participant_joined':
    case 'participant_left': {
      const p = d.participant as BattleParticipantView;
      return {
        ...state,
        snap: {
          ...snap,
          participants: upsert(snap.participants, p),
          participantsCount: d.participantsCount as number,
        },
      };
    }
    case 'participant_kicked': {
      const p = d.participant as BattleParticipantView;
      return {
        ...state,
        snap: {
          ...snap,
          participants: snap.participants.filter((x) => x.id !== p.id),
          participantsCount: d.participantsCount as number,
        },
      };
    }
    case 'question_started':
      return {
        offsetMs: clockOffset(d.serverNow),
        snap: {
          ...snap,
          status: 'in_progress',
          phase: 'question',
          version: action.version,
          question: { ...(d as unknown as BattleQuestionView), correctPosition: undefined },
          answered: 0,
          reveal: null,
          leaderboard: null,
        },
      };
    case 'answer_progress':
      return {
        ...state,
        snap: {
          ...snap,
          answered: (d.answered as number | null) ?? snap.answered,
          active: d.active as number,
        },
      };
    case 'question_revealed':
      return {
        ...state,
        snap: { ...snap, phase: 'reveal', version: action.version, reveal: d as unknown as BattleHostReveal },
      };
    case 'leaderboard':
      return {
        ...state,
        snap: {
          ...snap,
          phase: 'leaderboard',
          version: action.version,
          leaderboard: d as unknown as BattleLeaderboardView,
        },
      };
    case 'finished':
      return {
        ...state,
        snap: {
          ...snap,
          status: 'finished',
          phase: 'finished',
          version: action.version,
          question: null,
          final: d as unknown as BattleFinalView,
        },
      };
    case 'cancelled':
      return {
        ...state,
        snap: {
          ...snap,
          status: 'cancelled',
          version: action.version,
          cancelReason: d.reason as 'host' | 'expired',
        },
      };
    default:
      return state;
  }
}

/**
 * Экран ведущего (/teacher/battle-sessions/:sid, BT-T04…T08): лобби с кодом и участниками, вопрос с таймером
 * и счётчиком ответов, раскрытие с диаграммой, промежуточный рейтинг, итог с пьедесталом. Режим проектора
 * (REQ-BTL-T10): крупная типографика, без боковой панели, управление внизу, выход по Esc.
 */
export function HostGame({ sessionId }: { sessionId: string }) {
  const t = useTranslations('battle.host');
  const locale = useLocale();
  const router = useRouter();
  const [state, dispatch] = useReducer(reduce, { snap: null, offsetMs: 0 });
  const onEvent = useCallback((e: BattleStreamEvent) => dispatch(e), []);
  const snap = state.snap;
  const over = Boolean(snap && (snap.status === 'finished' || snap.status === 'cancelled'));
  const { lost } = useBattleStream(`/api/teacher/battle-sessions/${sessionId}/events`, onEvent, over);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kicking, setKicking] = useState<BattleParticipantView | null>(null);
  const [projector, setProjector] = useState(false);

  // Esc закрывает режим проектора (и полноэкранный режим браузера).
  useEffect(() => {
    if (!projector) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setProjector(false);
    const onFullscreen = () => !document.fullscreenElement && setProjector(false);
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [projector]);

  function toggleProjector() {
    if (projector) {
      setProjector(false);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      return;
    }
    setProjector(true);
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }

  /** Переход API-BTL-23…27 с ожидаемой версией; 409 — свежий снимок из тела ошибки. */
  async function act(action: 'start' | 'close-question' | 'next' | 'finish' | 'cancel') {
    if (!snap) return;
    setBusy(true);
    setError(null);
    const res = await apiRequest<BattleHostSnapshot>(`/api/teacher/battle-sessions/${sessionId}/${action}`, {
      method: 'POST',
      body: { expectedVersion: snap.version },
      locale,
    });
    setBusy(false);
    if (res.kind === 'ok') return dispatch({ type: 'replace', snap: res.data });
    if (res.kind === 'http' && res.error.snapshot)
      dispatch({ type: 'replace', snap: res.error.snapshot as BattleHostSnapshot });
    const key = res.kind === 'http' ? res.error.fieldErrors?.battle : 'network';
    if (key !== 'staleState')
      setError(key && t.has(`errors.${key}`) ? t(`errors.${key}`) : t('errors.unknown'));
  }

  async function kick() {
    if (!kicking) return;
    const res = await apiRequest<BattleHostSnapshot>(
      `/api/teacher/battle-sessions/${sessionId}/participants/${kicking.id}/kick`,
      { method: 'POST', locale },
    );
    setKicking(null);
    if (res.kind === 'ok') dispatch({ type: 'replace', snap: res.data });
  }

  async function playAgain() {
    if (!snap) return;
    const res = await createSession(snap.battleQuizId, { settings: snap.settings }, locale);
    if (res.ok) router.push(`/teacher/battle-sessions/${res.sessionId}`);
    else setError(t.has(`errors.${res.error}`) ? t(`errors.${res.error}`) : t('errors.unknown'));
  }

  const announce = useMemo(() => {
    if (!snap) return '';
    if (snap.phase === 'question' && snap.question)
      return t('question.counter', { index: snap.question.index + 1, total: snap.question.total });
    if (snap.phase === 'finished') return t('final.title');
    return '';
  }, [snap, t]);

  const controls = (children: React.ReactNode) => (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3',
        projector &&
          'fixed inset-x-0 bottom-0 z-[60] justify-center border-t border-[var(--border)] bg-[var(--bg)] p-4',
      )}
    >
      {children}
    </div>
  );

  return (
    <section
      className={cn(
        'mx-auto flex flex-col gap-6',
        projector
          ? 'battle-projector fixed inset-0 z-50 max-w-none overflow-y-auto bg-[var(--bg)] px-6 pb-28 pt-8 md:px-12'
          : 'max-w-[1040px] px-4 pt-8 pb-40 md:pb-8',
      )}
      data-testid="host-game"
      data-phase={snap?.phase}
      data-projector={projector || undefined}
    >
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      {lost ? <ConnectionBanner text={t('connection')} /> : null}
      {/* OPT-05 (О4-2а): как у лобби ведущего — строка заголовка и блок ≈ 400 px. */}
      {!snap ? (
        <>
          <Skeleton className="h-11 w-2/3" />
          <Skeleton className="h-[25rem]" />
        </>
      ) : null}
      {snap ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <h1
                className={cn(
                  'font-bold [overflow-wrap:anywhere]',
                  projector ? 'text-4xl' : 'text-cabinet-title',
                )}
              >
                {snap.battleTitle}
              </h1>
              {snap.className ? <p className="text-sm text-[var(--text-muted)]">{snap.className}</p> : null}
            </div>
            {snap.status !== 'finished' && snap.status !== 'cancelled' ? (
              <Button variant="secondary" onClick={toggleProjector} aria-pressed={projector}>
                {projector ? (
                  <Minimize2 aria-hidden="true" className="size-4" />
                ) : (
                  <Maximize2 aria-hidden="true" className="size-4" />
                )}
                {projector ? t('projectorExit') : t('projector')}
              </Button>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-[var(--danger-text)]">
              {error}
            </p>
          ) : null}
          <div
            key={`${snap.phase}-${snap.question?.index ?? ''}`}
            className="battle-phase flex flex-col gap-6"
          >
            {snap.status === 'cancelled' ? (
              <Card className="flex flex-col items-start gap-4 p-6">
                <h2 className="text-cabinet-block font-semibold">{t('cancelled')}</h2>
                <AppLink href="/teacher/battles" className="text-sm underline">
                  {t('back')}
                </AppLink>
              </Card>
            ) : snap.phase === 'lobby' ? (
              <>
                <Card
                  className="flex flex-col items-center gap-4 p-6 text-center md:p-10"
                  data-testid="host-lobby"
                >
                  <BigCode code={snap.code} copyLabel={t('lobby.copy')} copiedLabel={t('lobby.copied')} />
                  <p className={cn('text-[var(--text-muted)]', projector ? 'text-2xl' : 'text-base')}>
                    {t('lobby.hint')}
                  </p>
                  <p className="text-xl font-semibold" data-testid="host-count">
                    {t('lobby.count', { count: snap.participantsCount })}
                  </p>
                  <ul className="flex flex-wrap justify-center gap-2" aria-label={t('lobby.participants')}>
                    {snap.participants
                      .filter((p) => !p.left)
                      .map((p) => (
                        <li key={p.id}>
                          <ParticipantChip
                            name={p.displayName}
                            avatar={p.avatar}
                            removeLabel={t('lobby.kick', { name: p.displayName })}
                            onRemove={() => setKicking(p)}
                          />
                        </li>
                      ))}
                  </ul>
                </Card>
                {controls(
                  <>
                    <Button
                      variant="primary-blue"
                      disabled={busy || snap.participantsCount === 0}
                      onClick={() => void act('start')}
                    >
                      {t('lobby.start')}
                    </Button>
                    <Button variant="secondary" disabled={busy} onClick={() => void act('cancel')}>
                      {t('lobby.cancel')}
                    </Button>
                  </>,
                )}
              </>
            ) : snap.phase === 'question' && snap.question ? (
              <>
                <HostQuestion
                  question={snap.question}
                  offsetMs={state.offsetMs}
                  projector={projector}
                  answered={snap.answered}
                  total={snap.participantsCount}
                />
                {controls(
                  <>
                    <Button variant="primary-blue" disabled={busy} onClick={() => void act('close-question')}>
                      {t('question.close')}
                    </Button>
                    <Button variant="text" disabled={busy} onClick={() => void act('finish')}>
                      {t('finish')}
                    </Button>
                  </>,
                )}
              </>
            ) : snap.phase === 'reveal' && snap.reveal ? (
              <>
                <HostReveal reveal={snap.reveal} question={snap.question} projector={projector} />
                {controls(
                  <>
                    <Button variant="primary-blue" disabled={busy} onClick={() => void act('next')}>
                      {t('reveal.next')}
                    </Button>
                    <Button variant="text" disabled={busy} onClick={() => void act('finish')}>
                      {t('finish')}
                    </Button>
                  </>,
                )}
              </>
            ) : snap.phase === 'leaderboard' && snap.leaderboard ? (
              <>
                <section className="flex flex-col gap-4" data-testid="host-board">
                  <h2 className={cn('font-bold', projector ? 'text-4xl' : 'text-cabinet-block')}>
                    {t('leaderboard.title')}
                  </h2>
                  <BattleTop board={snap.leaderboard} />
                </section>
                {controls(
                  <>
                    <Button variant="primary-blue" disabled={busy} onClick={() => void act('next')}>
                      {t('leaderboard.next')}
                    </Button>
                    <Button variant="text" disabled={busy} onClick={() => void act('finish')}>
                      {t('finish')}
                    </Button>
                  </>,
                )}
              </>
            ) : snap.phase === 'finished' && snap.final ? (
              <section className="flex flex-col gap-6" data-testid="host-final">
                <h2 className="text-cabinet-block font-semibold">{t('final.title')}</h2>
                <BattleFinal final={snap.final} />
                <div className="flex flex-wrap gap-3">
                  <Button variant="primary-blue" onClick={() => void playAgain()}>
                    {t('final.again')}
                  </Button>
                  <AppLink
                    href={`/teacher/battle-sessions/${sessionId}/results`}
                    className="inline-flex min-h-[var(--control-h)] items-center rounded-[var(--radius-pill)] border border-[var(--border)] px-5 text-sm font-semibold hover:bg-[var(--field)]"
                  >
                    {t('final.details')}
                  </AppLink>
                  <a
                    href={`/api/teacher/battle-sessions/${sessionId}/results.csv`}
                    className="inline-flex min-h-[var(--control-h)] items-center rounded-[var(--radius-pill)] border border-[var(--border)] px-5 text-sm font-semibold hover:bg-[var(--field)]"
                  >
                    {t('final.csv')}
                  </a>
                </div>
              </section>
            ) : null}
          </div>
        </>
      ) : null}
      <Modal
        open={kicking !== null}
        onOpenChange={(o) => !o && setKicking(null)}
        title={t('kick.title', { name: kicking?.displayName ?? '' })}
        description={t('kick.text')}
        closeLabel={t('kick.cancel')}
      >
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={() => void kick()}>
            {t('kick.confirm')}
          </Button>
          <Button variant="text" onClick={() => setKicking(null)}>
            {t('kick.cancel')}
          </Button>
        </div>
      </Modal>
    </section>
  );
}

function HostQuestion({
  question,
  offsetMs,
  projector,
  answered,
  total,
}: {
  question: BattleQuestionView;
  offsetMs: number;
  projector: boolean;
  answered: number;
  total: number;
}) {
  const t = useTranslations('battle.host');
  return (
    <section className="flex flex-col gap-5" data-testid="host-question">
      <CountdownBar
        deadlineAt={new Date(question.deadlineAt).getTime()}
        totalMs={question.timeLimitSec * 1000}
        offsetMs={offsetMs}
        label={(seconds) => t('question.timer', { seconds })}
        large
      />
      <div className="flex flex-wrap items-center justify-between gap-3 text-[var(--text-muted)]">
        <span className="font-semibold">
          {t('question.counter', { index: question.index + 1, total: question.total })}
        </span>
        <span className="text-lg font-semibold text-[var(--text)]" data-testid="host-answered">
          {t('question.answered', { answered, total })}
        </span>
      </div>
      <h2
        className={cn(
          'font-bold [overflow-wrap:anywhere]',
          projector ? 'text-[clamp(40px,4vw,64px)] leading-tight' : 'text-3xl',
        )}
      >
        {question.text}
      </h2>
      {question.imageUrl ? (
        <img
          src={question.imageUrl}
          alt=""
          className={cn(
            'w-full rounded-[var(--radius-card)] object-contain',
            projector ? 'max-h-[40vh]' : 'max-h-72',
          )}
        />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {question.options.map((o) => (
          <AnswerTile key={o.position} position={o.position} large={projector}>
            {o.text}
          </AnswerTile>
        ))}
      </div>
    </section>
  );
}

function HostReveal({
  reveal,
  question,
  projector,
}: {
  reveal: BattleHostReveal;
  question: BattleQuestionView | null;
  projector: boolean;
}) {
  const t = useTranslations('battle.host');
  const time = useBattleTime();
  const max = Math.max(1, ...reveal.distribution.map((d) => d.count));
  return (
    <section className="flex flex-col gap-6" data-testid="host-reveal">
      {question ? (
        <>
          <h2 className={cn('font-bold [overflow-wrap:anywhere]', projector ? 'text-4xl' : 'text-2xl')}>
            {question.text}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {question.options.map((o) => (
              <AnswerTile
                key={o.position}
                position={o.position}
                large={projector}
                state={o.position === reveal.correctPosition ? 'correct' : 'dimmed'}
                data-testid="host-reveal-tile"
              >
                {o.text}
              </AnswerTile>
            ))}
          </div>
        </>
      ) : null}
      {/* Столбчатая диаграмма распределения: цвет + фигура + буква + число (BT-T06). */}
      <figure className="flex flex-col gap-3">
        <figcaption className="text-sm font-semibold text-[var(--text-muted)]">
          {t('reveal.distribution')}
        </figcaption>
        <ul className="flex h-48 items-end gap-3" data-testid="host-distribution">
          {reveal.distribution.map((d) => (
            <li
              key={d.position}
              className="flex h-full flex-1 flex-col items-center justify-end gap-2"
              aria-label={t('reveal.bar', { letter: ANSWER_LETTERS[d.position - 1]!, count: d.count })}
            >
              <span className="text-lg font-bold tabular-nums" aria-hidden="true">
                {d.count}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'flex w-full items-start justify-center rounded-t-[var(--radius-item)] pt-1',
                  answerToneClass(d.position),
                  d.position !== reveal.correctPosition && 'opacity-60',
                )}
                style={{ height: `${Math.max(6, (d.count / max) * 100)}%` }}
              >
                <AnswerShape position={d.position} className="size-4" />
              </span>
              <span aria-hidden="true" className="text-sm font-bold">
                {ANSWER_LETTERS[d.position - 1]}
              </span>
            </li>
          ))}
        </ul>
      </figure>
      <p className="text-[var(--text-muted)]">
        {reveal.avgResponseMs !== null
          ? t('reveal.avgTime', { time: time(reveal.avgResponseMs) })
          : t('reveal.noAnswers')}
      </p>
    </section>
  );
}
