'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, X } from 'lucide-react';
import {
  type BattleFinalView,
  type BattleLeaderboardView,
  type BattleQuestionView,
  type BattleStudentReveal,
  type BattleStudentSnapshot,
} from '@syntara/shared';
import {
  ANSWER_LETTERS,
  AnswerTile,
  Button,
  Card,
  ConnectionBanner,
  CountdownBar,
  Skeleton,
} from '@syntara/ui';
import { useRouter } from '@/i18n/navigation';
import { apiRequest } from '@/lib/api/browser';
import { AppLink } from '../app-link';
import { BattleFinal, BattleTop, useBattleTime } from './battle-parts';
import { STUDENT_BATTLE_WIDTH } from './student-join';
import { type BattleStreamEvent, clockOffset, useBattleStream } from './use-battle-stream';

interface State {
  snap: BattleStudentSnapshot | null;
  offsetMs: number;
  answering: boolean;
  timeUp: boolean;
}

type Action =
  | BattleStreamEvent
  | { type: 'answered'; index: number; position: number }
  | { type: 'timeUp' }
  | { type: 'answering'; value: boolean };

/** Применение события к снимку (6.9); события со старой версией игнорируются (BR-BTL-08). */
function reduce(state: State, action: Action): State {
  if (action.type === 'answered') {
    if (!state.snap) return state;
    return {
      ...state,
      answering: false,
      snap: { ...state.snap, myAnswer: { questionIndex: action.index, optionPosition: action.position } },
    };
  }
  if (action.type === 'timeUp') return { ...state, timeUp: true };
  if (action.type === 'answering') return { ...state, answering: action.value };
  if (action.type === 'snapshot') {
    const snap = action.data as unknown as BattleStudentSnapshot;
    return { snap, offsetMs: clockOffset(snap.serverNow), answering: false, timeUp: false };
  }
  const snap = state.snap;
  if (!snap) return state;
  if (action.version < snap.version) return state;
  const d = action.data;
  switch (action.type) {
    case 'participant_joined':
    case 'participant_left':
    case 'participant_kicked':
      return { ...state, snap: { ...snap, participantsCount: d.participantsCount as number } };
    case 'question_started':
      return {
        ...state,
        offsetMs: clockOffset(d.serverNow),
        timeUp: false,
        answering: false,
        snap: {
          ...snap,
          status: 'in_progress',
          phase: 'question',
          version: action.version,
          question: d as unknown as BattleQuestionView,
          myAnswer: null,
          reveal: null,
          leaderboard: null,
        },
      };
    case 'question_revealed': {
      const reveal = d as unknown as BattleStudentReveal;
      return {
        ...state,
        snap: {
          ...snap,
          phase: 'reveal',
          version: action.version,
          reveal,
          myCorrectCount: reveal.myCorrectCount,
        },
      };
    }
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
    case 'kicked':
      return { ...state, snap: { ...snap, kicked: true } };
    default:
      return state;
  }
}

/**
 * Игра ученика (/learn/battles/:sid, BT-S02…S06): лобби, вопрос, раскрытие, промежуточный рейтинг, итог.
 * Состояние — снимок API-BTL-41 и события SSE API-BTL-42; смены фаз объявляются через aria-live (REQ-BTL-GEN-03).
 */
export function StudentGame({ sessionId }: { sessionId: string }) {
  const t = useTranslations('battle.student');
  const locale = useLocale();
  const router = useRouter();
  const [state, dispatch] = useReducer(reduce, { snap: null, offsetMs: 0, answering: false, timeUp: false });
  const onEvent = useCallback((e: BattleStreamEvent) => dispatch(e), []);
  const snap = state.snap;
  const over = Boolean(snap && (snap.kicked || snap.status === 'finished' || snap.status === 'cancelled'));
  const { lost } = useBattleStream(`/api/student/battle-sessions/${sessionId}/events`, onEvent, over);
  // Один clientAnswerId на вопрос: повтор после обрыва — тот же ответ (BR-BTL-03).
  const answerIds = useRef(new Map<number, string>());
  const [answerError, setAnswerError] = useState<string | null>(null);

  async function answer(position: number) {
    const q = snap?.question;
    if (!q || snap.myAnswer || state.answering || state.timeUp) return;
    const clientAnswerId = answerIds.current.get(q.index) ?? crypto.randomUUID();
    answerIds.current.set(q.index, clientAnswerId);
    dispatch({ type: 'answering', value: true });
    setAnswerError(null);
    const res = await apiRequest(`/api/student/battle-sessions/${sessionId}/answers`, {
      method: 'POST',
      body: { questionIndex: q.index, optionPosition: position, clientAnswerId },
      locale,
    });
    if (res.kind === 'ok') return dispatch({ type: 'answered', index: q.index, position });
    dispatch({ type: 'answering', value: false });
    if (res.kind === 'http' && res.error.fieldErrors?.battle === 'questionClosed')
      return dispatch({ type: 'timeUp' });
    setAnswerError(t('errors.network'));
  }

  async function leave() {
    await apiRequest(`/api/student/battle-sessions/${sessionId}/leave`, { method: 'POST', locale });
    router.push('/learn/battles');
  }

  const onExpire = useCallback(() => dispatch({ type: 'timeUp' }), []);

  const announce = useMemo(() => {
    if (!snap) return '';
    if (snap.kicked) return t('errors.kicked');
    if (snap.status === 'cancelled') return t('cancelled');
    if (snap.phase === 'question' && snap.question) {
      if (state.timeUp && !snap.myAnswer) return t('question.timeUp');
      return t('question.counter', { index: snap.question.index + 1, total: snap.question.total });
    }
    if (snap.phase === 'reveal' && snap.reveal)
      return snap.reveal.isCorrect ? t('reveal.correct') : t('reveal.wrong');
    if (snap.phase === 'finished') return t('final.title');
    return '';
  }, [snap, state.timeUp, t]);

  return (
    <section
      className={`mx-auto flex ${STUDENT_BATTLE_WIDTH} flex-col gap-6 px-4 py-8`}
      data-testid="student-game"
      data-phase={snap?.phase}
    >
      <p className="sr-only" aria-live="polite" data-testid="battle-announce">
        {announce}
      </p>
      {lost ? <ConnectionBanner text={t('connection')} /> : null}
      {!snap ? <Skeleton className="h-48" /> : null}
      {snap ? (
        <div key={`${snap.phase}-${snap.question?.index ?? ''}`} className="battle-phase flex flex-col gap-6">
          {snap.kicked ? (
            <Message title={t('errors.kicked')} />
          ) : snap.status === 'cancelled' ? (
            <Message title={t('cancelled')} />
          ) : snap.phase === 'lobby' ? (
            <Card className="flex flex-col items-center gap-3 p-8 text-center" data-testid="battle-lobby">
              <span aria-hidden="true" className="battle-waiting text-5xl">
                ⚡
              </span>
              <h1 className="text-cabinet-title font-bold">{t('lobby.inGame')}</h1>
              <p className="text-lg font-semibold [overflow-wrap:anywhere]">{snap.battleTitle}</p>
              <p className="text-[var(--text-muted)]">{t('lobby.teacher', { name: snap.teacherName })}</p>
              <p>{t('lobby.waiting')}</p>
              <p className="text-sm text-[var(--text-muted)]">
                {t('lobby.participants', { count: snap.participantsCount })} ·{' '}
                {t('lobby.you', { name: snap.myName })}
              </p>
              <Button variant="secondary" onClick={() => void leave()}>
                {t('leave')}
              </Button>
            </Card>
          ) : snap.phase === 'question' && snap.question ? (
            <QuestionView
              question={snap.question}
              offsetMs={state.offsetMs}
              myPosition={
                snap.myAnswer?.questionIndex === snap.question.index ? snap.myAnswer.optionPosition : null
              }
              busy={state.answering}
              timeUp={state.timeUp}
              onAnswer={(p) => void answer(p)}
              onExpire={onExpire}
              error={answerError}
            />
          ) : snap.phase === 'reveal' && snap.reveal ? (
            <RevealView reveal={snap.reveal} question={snap.question} />
          ) : snap.phase === 'leaderboard' && snap.leaderboard ? (
            <section className="flex flex-col gap-4" data-testid="battle-board">
              <h1 className="text-cabinet-title font-bold">{t('leaderboard.title')}</h1>
              <BattleTop board={snap.leaderboard} />
              {snap.leaderboard.me ? (
                <p className="text-lg font-semibold" data-testid="battle-my-place">
                  {t('leaderboard.me', { rank: snap.leaderboard.me.rank })}
                </p>
              ) : null}
            </section>
          ) : snap.phase === 'finished' && snap.final ? (
            <FinalView final={snap.final} sessionId={sessionId} />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Message({ title }: { title: string }) {
  const t = useTranslations('battle.student');
  return (
    <Card className="flex flex-col items-start gap-4 p-6" data-testid="battle-message">
      <h1 className="text-cabinet-title font-bold">{title}</h1>
      <AppLink
        href="/learn/battles"
        className="inline-flex min-h-11 items-center rounded-[var(--radius-pill)] border border-[var(--border)] px-4 text-sm font-semibold hover:bg-[var(--field)]"
      >
        {t('results.back')}
      </AppLink>
    </Card>
  );
}

function QuestionView({
  question,
  offsetMs,
  myPosition,
  busy,
  timeUp,
  onAnswer,
  onExpire,
  error,
}: {
  question: BattleQuestionView;
  offsetMs: number;
  myPosition: number | null;
  busy: boolean;
  timeUp: boolean;
  onAnswer: (position: number) => void;
  onExpire: () => void;
  error: string | null;
}) {
  const t = useTranslations('battle.student');
  const locked = myPosition !== null || timeUp || busy;
  const grid = useRef<HTMLDivElement>(null);
  // Стрелки перемещают фокус между плитками; ответ — Enter или пробел (REQ-BTL-S03).
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
      const tiles = [...el.querySelectorAll<HTMLButtonElement>('button')];
      const i = tiles.indexOf(document.activeElement as HTMLButtonElement);
      if (i < 0) return;
      e.preventDefault();
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
      tiles[(i + step + tiles.length) % tiles.length]?.focus();
    };
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, []);
  return (
    <section className="flex flex-col gap-5" data-testid="battle-question">
      <CountdownBar
        deadlineAt={new Date(question.deadlineAt).getTime()}
        totalMs={question.timeLimitSec * 1000}
        offsetMs={offsetMs}
        label={(seconds) => t('question.timer', { seconds })}
        onExpire={onExpire}
      />
      <p className="text-sm font-semibold text-[var(--text-muted)]">
        {t('question.counter', { index: question.index + 1, total: question.total })}
      </p>
      <h1 className="text-2xl font-bold [overflow-wrap:anywhere] sm:text-3xl">{question.text}</h1>
      {question.imageUrl ? (
        <img
          src={question.imageUrl}
          alt=""
          className="max-h-64 w-full rounded-[var(--radius-card)] object-contain"
        />
      ) : null}
      <div
        ref={grid}
        role="group"
        aria-label={t('question.options')}
        className="grid gap-3 sm:grid-cols-2"
      >
        {question.options.map((o) => (
          <AnswerTile
            key={o.position}
            position={o.position}
            onSelect={() => onAnswer(o.position)}
            disabled={locked}
            aria-pressed={myPosition === o.position}
            state={myPosition === null ? 'idle' : myPosition === o.position ? 'selected' : 'dimmed'}
            data-testid="battle-tile"
          >
            {o.text}
          </AnswerTile>
        ))}
      </div>
      <p className="text-lg font-semibold" data-testid="battle-answer-state">
        {myPosition !== null ? t('question.accepted') : timeUp ? t('question.timeUp') : ''}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-[var(--danger-text)]">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function RevealView({
  reveal,
  question,
}: {
  reveal: BattleStudentReveal;
  question: BattleQuestionView | null;
}) {
  const t = useTranslations('battle.student');
  const correct = question?.options.find((o) => o.position === reveal.correctPosition);
  return (
    <Card
      className="flex flex-col items-center gap-4 p-8 text-center"
      data-testid="battle-reveal"
      data-correct={reveal.isCorrect}
    >
      {reveal.isCorrect ? (
        <>
          <Check aria-hidden="true" className="size-16 text-[var(--success-text)]" strokeWidth={3} />
          <h1 className="text-4xl font-bold text-[var(--success-text)]">{t('reveal.correct')}</h1>
        </>
      ) : (
        <>
          <X aria-hidden="true" className="size-16 text-[var(--danger-text)]" strokeWidth={3} />
          <h1 className="text-4xl font-bold text-[var(--danger-text)]">{t('reveal.wrong')}</h1>
          {correct ? (
            <p className="text-lg">
              {t('reveal.correctAnswer', {
                letter: ANSWER_LETTERS[correct.position - 1]!,
                text: correct.text,
              })}
            </p>
          ) : null}
        </>
      )}
      <p className="text-lg">{t('reveal.correctCount', { count: reveal.myCorrectCount })}</p>
      {reveal.myRank ? (
        <p className="text-lg font-semibold">
          {t('reveal.place', { rank: reveal.myRank, total: reveal.participantsCount })}
        </p>
      ) : null}
    </Card>
  );
}

function FinalView({ final, sessionId }: { final: BattleFinalView; sessionId: string }) {
  const t = useTranslations('battle.student');
  const time = useBattleTime();
  const me = final.me;
  return (
    <section className="relative flex flex-col gap-6" data-testid="battle-final">
      {me && me.rank <= 3 ? <Confetti /> : null}
      <h1 className="text-cabinet-title font-bold">{t('final.title')}</h1>
      <BattleFinal final={final} showMe />
      {me ? (
        <Card className="flex flex-col gap-1 p-5" data-testid="battle-my-result">
          <span className="text-lg font-bold">
            {t('final.myPlace', { rank: me.rank, total: final.table.length })}
          </span>
          <span>{t('final.myCorrect', { correct: me.correctCount, total: final.questionsCount })}</span>
          <span className="text-[var(--text-muted)]">
            {t('final.myTime', { time: time(me.correctTimeMs) })}
          </span>
        </Card>
      ) : null}
      <AppLink
        href={`/learn/battles/${sessionId}/results`}
        className="inline-flex min-h-[var(--control-h)] items-center self-start rounded-[var(--radius-pill)] bg-[var(--accent-strong)] px-5 text-sm font-semibold text-white hover:brightness-110"
      >
        {t('final.answers')}
      </AppLink>
    </section>
  );
}

/** Короткое CSS-конфетти для мест 1–3 (BT-S06); скрыто при reduced motion и «Экономии трафика». */
function Confetti() {
  return (
    <div
      aria-hidden="true"
      data-decorative
      className="battle-confetti pointer-events-none absolute inset-x-0 top-0 h-40 overflow-hidden"
    >
      {Array.from({ length: 24 }, (_, i) => (
        <span
          key={i}
          style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 6) * 120}ms` }}
          data-tone={i % 4}
        />
      ))}
    </div>
  );
}
