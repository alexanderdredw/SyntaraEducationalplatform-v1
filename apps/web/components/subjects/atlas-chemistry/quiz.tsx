'use client';

import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type AtlasQuizKind } from '@syntara/shared';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { AppLink } from '../../app-link';
import { useAtlasSubject } from './atlas-data';
import { GuestInvite, PreviewNote, useAtlasViewer } from './gate';
import { elementHref, scientistHref } from './routes';

type Session = components['schemas']['AtlasQuizSessionDto'];
type Question = NonNullable<Session['question']>;
type Answer = components['schemas']['AtlasQuizAnswerResultDto'];
type Preview = components['schemas']['AtlasPreviewDto'];
type Mistake = NonNullable<Session['result']>['mistakes'][number];

/**
 * Откуда квиз берёт вопросы и проверку: ученик — сессия на сервере (API-S-24…27, XP BR-XP-05); учитель — `preview`:
 * вопросы с ответами (API-T-32), проверка в браузере, ничего не записывается (решение владельца 2026-10-28).
 */
interface QuizSource {
  preview: boolean;
  load(): Promise<Session | null>;
  answer(optionId: string): Promise<Answer | null>;
  finish(): Promise<Session | null>;
}

function studentSource(sessionId: string, locale: string): QuizSource {
  return {
    preview: false,
    async load() {
      const res = await apiRequest<Session>(`/api/student/atlas-quiz/${sessionId}`, { locale });
      return res.kind === 'ok' ? res.data : null;
    },
    async answer(optionId) {
      const res = await apiRequest<Answer>(`/api/student/atlas-quiz/${sessionId}/answers`, {
        method: 'POST',
        body: { optionId },
        locale,
      });
      return res.kind === 'ok' ? res.data : null;
    },
    async finish() {
      const res = await apiRequest<Session>(`/api/student/atlas-quiz/${sessionId}/finish`, {
        method: 'POST',
        locale,
      });
      return res.kind === 'ok' ? res.data : null;
    },
  };
}

/** Учитель: те же вопросы по одному, ответ сверяется с `correct`, ошибки — в «Рекомендуется повторить». */
function teacherSource(preview: Preview, kind: AtlasQuizKind): QuizSource {
  const total = preview.questions.length;
  const questions: Question[] = preview.questions.map((q, i) => ({
    index: i + 1,
    difficulty: q.difficulty,
    text: q.text,
    options: q.options.map((title, j) => ({ id: String(j), title })),
  }));
  let index = 0;
  let correct = 0;
  const mistakes: Mistake[] = [];
  const session = (): Session => ({
    id: 'preview',
    kind,
    status: 'in_progress',
    total,
    answered: index,
    correct,
    question: questions[index] ?? null,
    result: null,
  });
  return {
    preview: true,
    async load() {
      return session();
    },
    async answer(optionId) {
      const q = preview.questions[index];
      if (!q) return null;
      const ok = optionId === String(q.correct);
      if (ok) correct++;
      else mistakes.push(q.answer);
      index++;
      return { correct: ok, correctOptionId: String(q.correct), next: questions[index] ?? null };
    },
    async finish() {
      const percent = Math.round((100 * correct) / Math.max(1, total));
      return {
        ...session(),
        status: 'finished',
        question: null,
        result: { correct, total, percent, xpAwarded: 0, mistakes },
      };
    },
  };
}

/** Автопереход к следующему вопросу — как в оригинале (Quiz.js, ScientistsQuiz.js). */
const NEXT_MS = 2000;

/** Квиз «Проверь знания» (/quiz, REQ-ATL-03): экран оригинала Quiz.js, вопросы и XP — сервер (BR-XP-05). */
export default function AtlasQuizScreen() {
  return (
    <section
      id="view-learn"
      className="quiz-section"
      style={{ display: 'flex' }}
      data-testid="atlas-quiz-screen"
    >
      <AtlasQuiz kind="elements" />
    </section>
  );
}

/**
 * Квиз атласа: «Проверь знания» (elements) или игра «Кто этот учёный?» (scientists, решение А-5). Вопросы строит и
 * проверяет сервер (API-S-24…27): адаптивная сложность как в оригинале, правильный ответ — только после ответа
 * (BR-QZ-01); XP — 1 за верный ответ, не больше 20 в день (BR-XP-05). Сессия — в адресе (?session=): обновление
 * страницы и смена языка продолжают квиз. Гостю — вход; учитель проходит так же, но ничего не записывается и XP не
 * начисляются (решение владельца 2026-10-28).
 */
export function AtlasQuiz({ kind, extra }: { kind: AtlasQuizKind; extra?: React.ReactNode }) {
  const viewer = useAtlasViewer();
  const params = useSearchParams();
  const sessionId = params.get('session');
  const [started, setStarted] = useState<string | null>(sessionId);
  if (started && viewer === 'student')
    return <StudentRun key={started} kind={kind} sessionId={started} onRetry={() => setStarted(null)} />;
  return <Intro kind={kind} extra={extra} onStart={setStarted} />;
}

function StudentRun({
  kind,
  sessionId,
  onRetry,
}: {
  kind: AtlasQuizKind;
  sessionId: string;
  onRetry: () => void;
}) {
  const locale = useLocale();
  const source = useMemo(() => studentSource(sessionId, locale), [sessionId, locale]);
  return <Run kind={kind} source={source} onRetry={onRetry} />;
}

/** Учитель (API-T-32): пометка предпросмотра и тот же квиз; «Пройти ещё раз» — новые случайные вопросы. */
function TeacherRun({ kind }: { kind: AtlasQuizKind }) {
  const t = useTranslations('atlas');
  const tf = useTranslations('forms');
  const locale = useLocale();
  const subjectId = useAtlasSubject();
  const [round, setRound] = useState(0);
  const preview = useQuery({
    queryKey: ['teacher', 'atlas', 'preview', subjectId, kind, locale, round],
    queryFn: async () => {
      const res = await apiRequest<Preview>(`/api/teacher/atlas/${subjectId}/preview?kind=${kind}`, {
        locale,
      });
      if (res.kind !== 'ok') throw new Error('preview');
      return res.data;
    },
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const source = useMemo(
    () => (preview.data ? teacherSource(preview.data, kind) : null),
    [preview.data, kind],
  );
  return (
    <div style={{ width: '100%' }} data-testid="atlas-quiz-preview">
      <PreviewNote>{t('preview.note')}</PreviewNote>
      {preview.isError ? (
        <p role="alert" style={{ color: 'var(--accent-red)' }}>
          {tf('serverError')}
        </p>
      ) : source ? (
        <Run key={round} kind={kind} source={source} onRetry={() => setRound((r) => r + 1)} />
      ) : null}
    </div>
  );
}

function setSessionParam(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('session', id);
  else url.searchParams.delete('session');
  window.history.replaceState(null, '', url);
}

function Intro({
  kind,
  extra,
  onStart,
}: {
  kind: AtlasQuizKind;
  extra?: React.ReactNode;
  onStart: (id: string) => void;
}) {
  const t = useTranslations('atlas');
  const tf = useTranslations('forms');
  const locale = useLocale();
  const subjectId = useAtlasSubject();
  const viewer = useAtlasViewer();
  const [state, setState] = useState<'idle' | 'busy' | 'failed' | 'gate' | 'preview'>('idle');
  const sci = kind === 'scientists';

  async function start() {
    if (viewer === 'guest') return setState('gate');
    if (viewer === 'teacher') return setState('preview');
    setState('busy');
    const res = await apiRequest<Session>(`/api/student/subjects/${subjectId}/atlas-quiz`, {
      method: 'POST',
      body: { kind },
      locale,
    });
    if (res.kind !== 'ok') return setState('failed');
    setSessionParam(res.data.id);
    onStart(res.data.id);
  }

  if (state === 'gate') return <GuestInvite />;
  if (state === 'preview') return <TeacherRun kind={kind} />;
  return (
    <div
      className="quiz-intro fade-in-up"
      style={sci ? { textAlign: 'center', marginTop: '2rem' } : undefined}
      data-testid="atlas-quiz-intro"
    >
      {sci ? (
        <h2 className="hero-title" style={{ fontSize: '2rem' }}>
          {t('scientistsQuiz.title')}
        </h2>
      ) : (
        <h1 className="hero-title">
          {t.rich('quiz.title', { accent: (chunks) => <span className="text-gradient">{chunks}</span> })}
        </h1>
      )}
      <p className="hero-subtitle" style={sci ? { marginBottom: '2rem', fontSize: '1.1rem' } : undefined}>
        {sci ? t('scientistsQuiz.subtitle') : t('quiz.subtitle')}
      </p>
      <div className="atlas-quiz-actions">
        <button
          type="button"
          className="btn btn-primary"
          id={sci ? 'start-sci-quiz-btn' : 'start-quiz-btn'}
          disabled={state === 'busy'}
          onClick={() => void start()}
          data-testid="atlas-quiz-start"
        >
          {t('quiz.start')}
        </button>
        {extra}
      </div>
      {state === 'failed' ? (
        <p role="alert" style={{ marginTop: '1rem', color: 'var(--accent-red)' }}>
          {tf('serverError')}
        </p>
      ) : null}
    </div>
  );
}

const ELEMENT_LEVEL_COLOR: Record<Question['difficulty'], string> = {
  easy: 'var(--success)',
  medium: 'var(--accent-gold)',
  hard: 'var(--accent-red)',
};
const SCIENTIST_LEVEL: Record<Question['difficulty'], { color: string; rgb: string }> = {
  easy: { color: '#4ADE80', rgb: '74,222,128' },
  medium: { color: '#FDE047', rgb: '253,224,71' },
  hard: { color: '#F87171', rgb: '248,113,113' },
};

function Run({ kind, source, onRetry }: { kind: AtlasQuizKind; source: QuizSource; onRetry: () => void }) {
  const t = useTranslations('atlas');
  const tf = useTranslations('forms');
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [answer, setAnswer] = useState<{ selected: string; result: Answer } | null>(null);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const timer = useRef(0);
  const sci = kind === 'scientists';

  // Состояние сессии на языке интерфейса (API-S-26): продолжение после обновления или смены языка.
  useEffect(() => {
    let cancelled = false;
    void source.load().then((data) => {
      if (cancelled) return;
      if (!data) {
        setSessionParam(null);
        return onRetry();
      }
      if (data.status === 'in_progress' && !data.question) return void finish();
      setSession(data);
      setQuestion(data.question);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- загрузка один раз на сессию и язык
  }, [source]);

  async function finish() {
    const res = await source.finish();
    if (!res) return setFailed(true);
    setSession(res);
    setQuestion(null);
    if (!source.preview) await queryClient.invalidateQueries({ queryKey: ['me', 'stats'] });
  }

  async function choose(optionId: string) {
    if (busy.current || answer || !question) return;
    busy.current = true;
    const res = await source.answer(optionId);
    busy.current = false;
    if (!res) return setFailed(true);
    setAnswer({ selected: optionId, result: res });
    timer.current = window.setTimeout(() => {
      setAnswer(null);
      if (res.next) setQuestion(res.next);
      else void finish();
    }, NEXT_MS);
  }

  if (failed)
    return (
      <p role="alert" style={{ color: 'var(--accent-red)' }}>
        {tf('serverError')}
      </p>
    );
  if (session?.result)
    return <Result kind={kind} result={session.result} preview={source.preview} onRetry={onRetry} />;
  if (!session || !question)
    return (
      <div className="typing-indicator" role="status" aria-label="…">
        <span />
        <span />
        <span />
      </div>
    );

  const level = sci ? SCIENTIST_LEVEL[question.difficulty] : null;
  const elementColor = ELEMENT_LEVEL_COLOR[question.difficulty];
  const badgeStyle: CSSProperties = level
    ? {
        fontSize: '0.75rem',
        fontWeight: 600,
        padding: '4px 12px',
        borderRadius: 99,
        background: `rgba(${level.rgb},0.2)`,
        color: level.color,
        border: `1px solid rgba(${level.rgb},0.4)`,
        transition: 'all 0.3s ease',
      }
    : {
        fontSize: '0.75rem',
        fontWeight: 600,
        padding: '4px 12px',
        borderRadius: 99,
        // Как в оригинале: «var(--x)20» — недопустимое значение, фон и рамка не применяются.
        background: `${elementColor}20`,
        color: elementColor,
        border: `1px solid ${elementColor}40`,
      };
  const optionStyle = (id: string): CSSProperties | undefined => {
    if (!answer) return sci ? { padding: 15, fontSize: '1.05rem' } : undefined;
    const correct = answer.result.correctOptionId;
    const base: CSSProperties = sci
      ? { padding: 15, fontSize: '1.05rem', pointerEvents: 'none' }
      : { pointerEvents: 'none' };
    if (id === correct)
      return { ...base, background: 'var(--success)', color: '#fff', borderColor: 'var(--success)' };
    if (id === answer.selected)
      return { ...base, background: 'var(--accent-red)', color: '#fff', borderColor: 'var(--accent-red)' };
    return answer.result.correct ? base : { ...base, opacity: 0.5 };
  };

  return (
    <div
      className="quiz-card fade-in"
      data-testid="atlas-quiz-question"
      style={
        sci
          ? {
              maxWidth: 800,
              margin: '0 auto',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: 20,
              padding: '2rem',
              border: '1px solid rgba(255,255,255,0.1)',
            }
          : undefined
      }
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: sci ? '1.5rem' : '1rem',
          width: sci ? undefined : '100%',
        }}
      >
        <div
          className="quiz-progress"
          style={sci ? { color: 'var(--text-secondary)', fontWeight: 600 } : undefined}
          data-testid="atlas-quiz-progress"
        >
          {t('quiz.progress', { current: question.index, total: session.total })}
        </div>
        <div className="difficulty-badge" style={badgeStyle} data-testid="atlas-quiz-difficulty">
          {t(`quiz.${question.difficulty}`)}
        </div>
      </div>
      <div
        className="quiz-question-container"
        style={sci ? { marginBottom: '2rem', textAlign: 'center' } : undefined}
      >
        <h3
          className="quiz-question-intro"
          id="atlas-quiz-q"
          style={sci ? { fontSize: '1.2rem', marginBottom: '1rem', color: '#fff' } : undefined}
        >
          {sci ? t('scientistsQuiz.questionIntro') : t('quiz.questionIntro')}
        </h3>
        <p
          className="quiz-question-desc"
          style={sci ? { fontSize: '1.1rem', lineHeight: 1.6, color: 'var(--text-secondary)' } : undefined}
        >
          {question.text}
        </p>
      </div>
      <div className="quiz-options" role="group" aria-labelledby="atlas-quiz-q">
        {question.options.map((o) => (
          <button
            key={o.id}
            type="button"
            className="btn btn-secondary quiz-opt"
            style={optionStyle(o.id)}
            aria-disabled={answer ? true : undefined}
            onClick={() => void choose(o.id)}
            data-testid="atlas-quiz-option"
          >
            {o.title}
          </button>
        ))}
      </div>
      <p className="atlas-sr-only" aria-live="polite">
        {answer ? (answer.result.correct ? t('assistant.correct') : t('assistant.incorrect')) : ''}
      </p>
    </div>
  );
}

function Result({
  kind,
  result,
  preview,
  onRetry,
}: {
  kind: AtlasQuizKind;
  result: NonNullable<Session['result']>;
  preview: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations('atlas');
  const tq = useTranslations('student.quiz');
  const subjectId = useAtlasSubject();
  const sci = kind === 'scientists';
  let message = result.percent >= 80 ? t('quiz.excellent') : t('quiz.keepLearning');
  if (!sci && result.mistakes.length === 0) {
    if (result.correct === result.total) message = t('quiz.perfect');
    else if (result.percent > 80) message = t('quiz.greatJob');
  }
  const retry = () => {
    setSessionParam(null);
    onRetry();
  };
  const accent = sci ? '#FDE047' : null;
  return (
    <div
      className="quiz-results fade-in-up"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        ...(sci ? { textAlign: 'center' } : {}),
      }}
      data-testid="atlas-quiz-result"
    >
      <h2 className="hero-title" style={sci ? { fontSize: '2.2rem' } : undefined}>
        {t('quiz.resultsTitle', { score: result.correct, total: result.total })}
      </h2>
      <p className="hero-subtitle" style={sci ? { fontSize: '1.2rem' } : undefined}>
        {message}
      </p>
      <div
        className="score-circle"
        style={
          sci
            ? {
                width: 140,
                height: 140,
                borderRadius: '50%',
                border: '4px solid #FDE047',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '2.5rem',
                fontWeight: 'bold',
                color: '#FDE047',
                margin: '2rem 0',
                boxShadow: '0 0 30px rgba(253,224,71,0.2)',
              }
            : {
                width: 120,
                height: 120,
                borderRadius: '50%',
                border: '4px solid var(--primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '2rem',
                fontWeight: 'bold',
                margin: '1.5rem 0',
                boxShadow: '0 0 20px var(--primary-glow)',
              }
        }
      >
        {result.percent}%
      </div>
      {/* Решение А-11: «+N XP» на экране результата — фактически начисленное; учителю XP нет. */}
      {preview ? null : (
        <p className="atlas-xp" data-testid="atlas-quiz-xp" style={{ marginTop: 0 }}>
          {tq('xp', { xp: result.xpAwarded })}
        </p>
      )}
      {result.mistakes.length ? (
        <div
          className="recommendation-section fade-in-up"
          style={{ animationDelay: '0.2s', marginTop: '2rem', width: '100%', maxWidth: sci ? 800 : 600 }}
        >
          <h3
            className="hero-subtitle"
            style={{
              marginBottom: sci ? '1.5rem' : '1rem',
              color: 'var(--text-secondary)',
              fontSize: '1.2rem',
              ...(sci ? { textAlign: 'center' } : {}),
            }}
          >
            {sci ? t('scientistsQuiz.review') : t('quiz.recommendation')}
          </h3>
          <div
            className="recommendation-grid"
            style={{
              display: 'grid',
              gap: '1rem',
              gridTemplateColumns: `repeat(auto-fit, minmax(${sci ? 300 : 250}px, 1fr))`,
            }}
          >
            {result.mistakes.map((m) => (
              <AppLink
                key={m.code}
                href={sci ? scientistHref(subjectId, m.code) : elementHref(subjectId, m.code)}
                className="recommendation-card atlas-rec-card"
                data-accent={accent ?? undefined}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  padding: '1rem',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1rem',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div
                  className="recommendation-icon"
                  aria-hidden="true"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: sci ? 'rgba(253,224,71,0.1)' : 'rgba(255,255,255,0.06)',
                    color: sci ? '#FDE047' : 'var(--text-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold',
                    flexShrink: 0,
                  }}
                >
                  {m.title.charAt(0)}
                </div>
                <div className="recommendation-info" style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                  <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)' }}>{m.title}</h4>
                  <p
                    style={{
                      margin: 0,
                      fontSize: '0.8rem',
                      color: 'var(--text-secondary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: sci ? 200 : 150,
                    }}
                  >
                    {m.description}
                  </p>
                </div>
                <div
                  aria-hidden="true"
                  style={{ color: 'var(--text-secondary)', transform: 'rotate(-90deg)' }}
                >
                  &#10140;
                </div>
              </AppLink>
            ))}
          </div>
        </div>
      ) : null}
      <div style={{ marginTop: sci ? '3rem' : '2rem' }}>
        <button
          type="button"
          className={`btn btn-primary${sci ? ' glow-effect' : ''}`}
          onClick={retry}
          data-testid="atlas-quiz-retry"
        >
          {t('quiz.retry')}
        </button>
      </div>
    </div>
  );
}
