'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import {
  ATLAS_QUIZ_MODES,
  type AtlasQuizKind,
  type AtlasQuizMode,
  checkSymbol,
  type ElementFamily,
  familiesWithLessons,
  HINT_LIMIT,
  pickHintRemovals,
} from '@syntara/shared';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import type { RunMistake, RunQuestion, RunSource, RunSummary } from '../../learn/test-run';
import { GROUP_COLORS, useAtlasData, useAtlasSubject } from './atlas-data';
import { GuestInvite, PreviewNote, useAtlasViewer } from './gate';
import { atlasHref, elementHref, scientistHref } from './routes';
import { AtlasTestRun, type AtlasTestPlacement } from './test-view';

type Session = components['schemas']['AtlasQuizSessionDto'];
type Question = NonNullable<Session['question']>;
type Answer = components['schemas']['AtlasQuizAnswerResultDto'];
type Hint = components['schemas']['AtlasHintResultDto'];
type Preview = components['schemas']['AtlasPreviewDto'];
type Info = components['schemas']['AtlasAnswerInfoDto'];

/** Объяснение, ссылка «Открыть урок →» и цвет свечения правильного ответа (REQ-TST-01, REQ-TST-09.3). */
interface Explain {
  text(info: Info): string | null;
  href(code: string): string;
  accent(info: Info): string;
}

function useExplain(kind: AtlasQuizKind): Explain {
  const t = useTranslations('test');
  const tp = useTranslations('student.periodicTable.families');
  const subjectId = useAtlasSubject();
  const sci = kind === 'scientists';
  return {
    // «Это {название} ({символ}, № {N}, {семейство}). {описание}» — только у элементов (у учёного это текст вопроса).
    text: (i) =>
      i.symbol && i.number && i.family
        ? t('explanation', {
            title: i.title,
            symbol: i.symbol,
            number: i.number,
            family: tp(i.family),
            description: i.description,
          }).trim()
        : null,
    href: (code) => (sci ? scientistHref(subjectId, code) : elementHref(subjectId, code)),
    accent: (i) => (sci ? GROUP_COLORS.scientist! : (GROUP_COLORS[i.family ?? ''] ?? 'var(--success)')),
  };
}

const KIND_TYPE: Record<Question['answerKind'], RunQuestion['type']> = {
  choice: 'single_choice',
  boolean: 'true_false',
  input: 'text_input',
  table: 'table_pick',
};

/** Вопрос сервера → вопрос движка: вид ответа (REQ-TST-10), заголовок, схема Бора, подсветка периодов. */
const toQuestion = (q: Question | Preview['questions'][number], id: string): RunQuestion => ({
  id,
  type: KIND_TYPE[q.answerKind],
  difficulty: q.difficulty,
  intro: q.intro,
  text: q.text,
  options: q.options.map((o) => ({ id: o.id, text: o.title })),
  removed: q.removed,
  shells: q.shells,
  rows: q.rows,
});

const answerBody = (body: { optionId?: string; textAnswer?: string }) =>
  body.textAnswer !== undefined ? { text: body.textAnswer } : { optionId: body.optionId };

function summaryOf(session: Session, explain: Explain): RunSummary | null {
  const r = session.result;
  if (!r) return null;
  return {
    correct: r.correct,
    total: r.total,
    percent: r.percent,
    hinted: r.hinted,
    xpAwarded: r.xpAwarded,
    bestPercent: r.bestPercent,
    previousPercent: r.previousPercent,
    badges: [],
    mastered: null,
    families: r.families,
    mistakes: r.mistakes.map((m) => ({
      question: m.question,
      yours: m.selected,
      correct: m.title,
      explanation: explain.text(m),
      href: explain.href(m.code),
    })),
  };
}

/**
 * Ученик: сессия на сервере (API-S-24…27; «50/50» — API-S-29, XP BR-XP-05 с весом подсказки 0,5). Завершённая сессия
 * (обновление страницы на результате) показывает результат без повторного завершения.
 */
function studentSource(
  sessionId: string,
  locale: string,
  explain: Explain,
): RunSource & { session(): Session | null } {
  let done: Session | null = null;
  let last: Session | null = null;
  const base = `/api/student/atlas-quiz/${sessionId}`;
  return {
    preview: false,
    adaptive: true,
    /** Последнее состояние сессии — режим и семейство для «Пройти ещё раз» (REQ-TST-11). */
    session: () => last,
    async load() {
      const res = await apiRequest<Session>(base, { locale });
      if (res.kind !== 'ok') return null;
      const s = res.data;
      last = s;
      if (s.status === 'finished') done = s;
      return {
        questions: s.question ? [toQuestion(s.question, `q${s.question.index}`)] : [],
        marks: s.answers,
        results: {},
        total: s.total,
        hintsLeft: s.hintsLeft,
      };
    },
    async answer(q, body) {
      const res = await apiRequest<Answer>(`${base}/answers`, {
        method: 'POST',
        body: answerBody(body),
        locale,
      });
      if (res.kind !== 'ok') return null;
      const a = res.data;
      return {
        result: {
          correct: a.correct,
          hinted: a.hinted,
          correctOptionId: a.correctOptionId,
          correctAnswer: a.correctAnswer,
          caseHint: a.caseHint,
          explanation: a.answer ? explain.text(a.answer) : null,
          lessonHref: a.answer ? explain.href(a.answer.code) : null,
          accent: a.answer ? explain.accent(a.answer) : null,
          optionId: body.optionId ?? null,
          textAnswer: body.textAnswer ?? null,
        },
        next: a.next ? toQuestion(a.next, `q${a.next.index}`) : null,
      };
    },
    async hint() {
      const res = await apiRequest<Hint>(`${base}/hint`, { method: 'POST', locale });
      return res.kind === 'ok'
        ? { removed: res.data.removedOptionIds, rows: res.data.rows, hintsLeft: res.data.hintsLeft }
        : null;
    },
    async finish() {
      if (!done) {
        const res = await apiRequest<Session>(`${base}/finish`, { method: 'POST', locale });
        if (res.kind !== 'ok') return null;
        done = res.data;
      }
      return summaryOf(done, explain);
    },
  };
}

/**
 * Учитель (API-T-32, AC-TST-12): те же вопросы по одному с правильным ответом — проверка (символ — с учётом регистра)
 * и «50/50» в браузере, ничего не записывается (решение владельца 2026-10-28; REQ-TST-04.5).
 */
function teacherSource(
  questions: Preview['questions'],
  explain: Explain,
  titleOf: (id: string) => string,
): RunSource {
  const run: RunQuestion[] = questions.map((q, i) => toQuestion(q, `p${i}`));
  const answers: Array<{ correct: boolean; hinted: boolean; yours: string }> = [];
  let hintsLeft = HINT_LIMIT;
  return {
    preview: true,
    adaptive: true,
    async load() {
      return { questions: run, marks: [], results: {}, total: run.length, hintsLeft };
    },
    async answer(q, body) {
      const i = run.findIndex((x) => x.id === q.id);
      const p = questions[i];
      if (!p) return null;
      const check = p.correctText !== null ? checkSymbol(body.textAnswer ?? '', p.correctText) : null;
      const correct = check ? check === 'correct' : body.optionId === p.correctOptionId;
      const hinted = q.removed.length > 0 || Boolean(q.rows?.length);
      const yours =
        body.textAnswer?.trim() ??
        (q.type === 'table_pick'
          ? titleOf(body.optionId ?? '')
          : (q.options.find((o) => o.id === body.optionId)?.text ?? ''));
      answers[i] = { correct, hinted, yours };
      return {
        result: {
          correct,
          hinted,
          correctOptionId: p.correctOptionId,
          correctAnswer: p.correctAnswer,
          caseHint: check === 'case',
          explanation: explain.text(p.answer),
          lessonHref: explain.href(p.answer.code),
          accent: explain.accent(p.answer),
          optionId: body.optionId ?? null,
          textAnswer: body.textAnswer ?? null,
        },
        next: run[i + 1] ?? null,
      };
    },
    async hint(q) {
      const p = questions[run.findIndex((x) => x.id === q.id)];
      if (!p || hintsLeft <= 0) return null;
      hintsLeft -= 1;
      if (q.type === 'table_pick') return { removed: [], rows: p.hintRows, hintsLeft };
      const removed = pickHintRemovals(
        q.options.map((o) => o.id),
        p.correctOptionId ?? '',
        (n) => Math.floor(Math.random() * n),
      );
      return { removed, hintsLeft };
    },
    async finish() {
      const correct = answers.filter((a) => a?.correct).length;
      const families = new Map<string, { correct: number; total: number }>();
      const mistakes: RunMistake[] = [];
      questions.forEach((p, i) => {
        const a = answers[i];
        if (!a) return;
        if (p.answer.family) {
          const f = families.get(p.answer.family) ?? { correct: 0, total: 0 };
          f.total += 1;
          if (a.correct) f.correct += 1;
          families.set(p.answer.family, f);
        }
        if (!a.correct)
          mistakes.push({
            question: p.text,
            yours: a.yours,
            correct: p.answer.title,
            explanation: explain.text(p.answer),
            href: explain.href(p.answer.code),
          });
      });
      return {
        correct,
        total: run.length,
        percent: Math.round((100 * correct) / Math.max(1, run.length)),
        hinted: answers.filter((a) => a?.correct && a.hinted).length,
        xpAwarded: 0,
        bestPercent: null,
        previousPercent: null,
        badges: [],
        mastered: null,
        families: [...families].map(([family, v]) => ({ family, ...v })),
        mistakes,
      };
    },
  };
}

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

/** Режим и семейство попытки (REQ-TST-11). */
interface Start {
  mode: AtlasQuizMode;
  family: ElementFamily | null;
}

/**
 * Квиз атласа: «Проверь знания» (elements) или игра «Кто этот учёный?» (scientists, решение А-5). Вопросы строит и
 * проверяет сервер (API-S-24…27): адаптивная сложность, правильный ответ — только после ответа (BR-QZ-01); XP — 1 за
 * верный ответ (с «50/50» — 0,5), не больше 20 в день (BR-XP-05, BR-TST-01). Квиз элементов — 9 типов вопросов
 * (REQ-TST-10) и режимы на стартовом экране (REQ-TST-11). Прохождение и результат — общий экран тестов в стиле атласа
 * (test-view.tsx, docs/TESTS_TZ.md). Сессия — в адресе (?session=): обновление страницы и смена языка продолжают
 * квиз. Гостю — вход; учитель проходит так же, но ничего не записывается и XP не начисляются.
 */
export function AtlasQuiz({ kind, extra }: { kind: AtlasQuizKind; extra?: React.ReactNode }) {
  const viewer = useAtlasViewer();
  const params = useSearchParams();
  const sessionId = params.get('session');
  const [started, setStarted] = useState<string | null>(sessionId);
  const reset = () => {
    setSessionParam(null);
    setStarted(null);
  };
  if (started && viewer === 'student')
    return (
      <StudentRun
        key={started}
        kind={kind}
        sessionId={started}
        onRestart={(id) => {
          setSessionParam(id);
          setStarted(id);
        }}
        onExit={reset}
      />
    );
  return <Intro kind={kind} extra={extra} onStart={setStarted} />;
}

function usePlacement(onExit: () => void): AtlasTestPlacement {
  const subjectId = useAtlasSubject();
  return { back: 'toAtlas', backHref: atlasHref(subjectId, 'home'), onExit, exitSaved: false };
}

/** Элементы с уроками — ячейки вопроса «Найдите на таблице» (REQ-TST-10.3). */
function useLessonElements() {
  return useAtlasData().data?.elements ?? [];
}

/** Заголовок вопроса: у квиза элементов он приходит с вопросом (REQ-TST-10), у игры про учёных — общий. */
function useIntro(kind: AtlasQuizKind) {
  const t = useTranslations('atlas');
  return kind === 'scientists' ? t('scientistsQuiz.questionIntro') : undefined;
}

function StudentRun({
  kind,
  sessionId,
  onRestart,
  onExit,
}: {
  kind: AtlasQuizKind;
  sessionId: string;
  onRestart: (id: string) => void;
  onExit: () => void;
}) {
  const locale = useLocale();
  const subjectId = useAtlasSubject();
  const explain = useExplain(kind);
  const placement = usePlacement(onExit);
  const elements = useLessonElements();
  const intro = useIntro(kind);
  const [failed, setFailed] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- источник — на сессию и язык
  const source = useMemo(() => studentSource(sessionId, locale, explain), [sessionId, locale]);

  /** Новая сессия: «Пройти ещё раз» — тот же режим, «Повторить ошибки» — только ошибки этой (REQ-TST-05.4). */
  async function restart(retry: boolean) {
    // «Пройти ещё раз» — в том же режиме (REQ-TST-11); после «Работы над ошибками» — «Быстрый».
    const mode = source.session()?.mode ?? 'quick';
    const family = source.session()?.family ?? null;
    const res = await apiRequest<Session>(`/api/student/subjects/${subjectId}/atlas-quiz`, {
      method: 'POST',
      body: retry
        ? { kind, retry: sessionId }
        : { kind, mode: mode === 'mistakes' ? 'quick' : mode, ...(family ? { family } : {}) },
      locale,
    });
    if (res.kind !== 'ok') return setFailed(true);
    onRestart(res.data.id);
  }

  if (failed) return <QuizError />;
  return (
    <AtlasTestRun
      source={source}
      placement={placement}
      intro={intro}
      elements={elements}
      onRetry={() => void restart(false)}
      onRetryMistakes={() => void restart(true)}
      testId="atlas-quiz"
    />
  );
}

function QuizError() {
  const tf = useTranslations('forms');
  return (
    <p role="alert" style={{ color: 'var(--accent-red)' }}>
      {tf('serverError')}
    </p>
  );
}

/** Учитель (API-T-32, AC-TST-12): пометка предпросмотра и тот же квиз в выбранном режиме; ничего не записывается. */
function TeacherRun({
  kind,
  start,
  onExit,
  onQuick,
}: {
  kind: AtlasQuizKind;
  start: Start;
  onExit: () => void;
  onQuick: () => void;
}) {
  const t = useTranslations('atlas');
  const locale = useLocale();
  const subjectId = useAtlasSubject();
  const explain = useExplain(kind);
  const placement = usePlacement(onExit);
  const elements = useLessonElements();
  const intro = useIntro(kind);
  const [round, setRound] = useState(0);
  // «Повторить ошибки» у учителя — те же вопросы, в которых были ошибки (ничего не записывается).
  const [only, setOnly] = useState<Preview['questions'] | null>(null);
  const preview = useQuery({
    queryKey: ['teacher', 'atlas', 'preview', subjectId, kind, start.mode, start.family, locale, round],
    queryFn: async () => {
      const query = new URLSearchParams({
        kind,
        mode: start.mode,
        ...(start.family ? { family: start.family } : {}),
      });
      const res = await apiRequest<Preview>(`/api/teacher/atlas/${subjectId}/preview?${query}`, { locale });
      if (res.kind === 'http' && res.status === 409) return null;
      if (res.kind !== 'ok') throw new Error('preview');
      return res.data;
    },
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const questions = only ?? preview.data?.questions ?? null;
  const titleOf = (id: string) => {
    const e = elements.find((x) => x.topicId === id);
    return e ? `${e.title} (${e.symbol})` : '';
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- источник — на набор вопросов
  const source = useMemo(() => (questions ? teacherSource(questions, explain, titleOf) : null), [questions]);
  return (
    <div style={{ width: '100%' }} data-testid="atlas-quiz-preview">
      <PreviewNote>{t('preview.note')}</PreviewNote>
      {preview.isError ? (
        <QuizError />
      ) : preview.data === null ? (
        <NoMistakes onQuick={onQuick} />
      ) : source && questions ? (
        <AtlasTestRun
          key={`${round}-${only ? 'm' : 'a'}-${questions.length}`}
          source={source}
          placement={placement}
          intro={intro}
          elements={elements}
          onRetry={() => {
            setOnly(null);
            setRound((r) => r + 1);
          }}
          onRetryMistakes={(summary) => {
            const wrong = new Set(summary.mistakes.map((m) => m.question));
            setOnly(questions.filter((q) => wrong.has(q.text)));
          }}
          testId="atlas-quiz"
        />
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

/** «Работа над ошибками» без ошибок (REQ-TST-11): «Ошибок нет — отличная работа!» и кнопка «Быстрый». */
function NoMistakes({ onQuick }: { onQuick: () => void }) {
  const t = useTranslations('atlas.quiz.modes');
  return (
    <div className="atlas-quiz-empty" role="status" data-testid="atlas-quiz-no-mistakes">
      <p>{t('noMistakes')}</p>
      <button type="button" className="btn btn-primary" onClick={onQuick} data-testid="atlas-quiz-quick">
        {t('quick')}
      </button>
    </div>
  );
}

const MODE_TEXT: Record<AtlasQuizMode, string> = {
  quick: 'quickText',
  family: 'familyText',
  mistakes: 'mistakesText',
  table: 'tableText',
};

/** REQ-TST-11: выбор режима — радиокнопки в виде карточек атласа; «По семейству» — с выбором семейства (≥ 4 урока). */
function Modes({
  value,
  onChange,
  families,
}: {
  value: Start;
  onChange: (next: Start) => void;
  families: ElementFamily[];
}) {
  const t = useTranslations('atlas.quiz.modes');
  const tg = useTranslations('atlas.group');
  return (
    <fieldset className="atlas-quiz-modes" data-testid="atlas-quiz-modes">
      <legend className="atlas-sr-only">{t('title')}</legend>
      {ATLAS_QUIZ_MODES.map((mode) => (
        <label key={mode} className="atlas-quiz-mode" data-checked={value.mode === mode || undefined}>
          <input
            type="radio"
            name="atlas-quiz-mode"
            value={mode}
            checked={value.mode === mode}
            onChange={() =>
              onChange({ mode, family: mode === 'family' ? (value.family ?? families[0] ?? null) : null })
            }
            data-testid={`atlas-quiz-mode-${mode}`}
          />
          <span className="atlas-quiz-mode-title">{t(mode)}</span>
          <span className="atlas-quiz-mode-text">{t(MODE_TEXT[mode])}</span>
        </label>
      ))}
      {value.mode === 'family' ? (
        <label className="atlas-quiz-family">
          <span>{t('familyPick')}</span>
          <select
            value={value.family ?? ''}
            onChange={(e) => onChange({ mode: 'family', family: e.target.value as ElementFamily })}
            data-testid="atlas-quiz-family"
          >
            {families.map((f) => (
              <option key={f} value={f}>
                {tg(f)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </fieldset>
  );
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
  const elements = useLessonElements();
  const [state, setState] = useState<'idle' | 'busy' | 'failed' | 'gate' | 'preview' | 'noMistakes'>('idle');
  const [choice, setChoice] = useState<Start>({ mode: 'quick', family: null });
  const sci = kind === 'scientists';
  const families = useMemo(() => familiesWithLessons(elements.map((e) => e.group)), [elements]);

  async function start(next: Start = choice) {
    if (viewer === 'guest') return setState('gate');
    setChoice(next);
    if (viewer === 'teacher') return setState('preview');
    setState('busy');
    const res = await apiRequest<Session>(`/api/student/subjects/${subjectId}/atlas-quiz`, {
      method: 'POST',
      body: sci ? { kind } : { kind, mode: next.mode, ...(next.family ? { family: next.family } : {}) },
      locale,
    });
    if (res.kind === 'http' && res.status === 409) return setState('noMistakes');
    if (res.kind !== 'ok') return setState('failed');
    setSessionParam(res.data.id);
    onStart(res.data.id);
  }
  const quick = () => void start({ mode: 'quick', family: null });

  if (state === 'gate') return <GuestInvite />;
  if (state === 'preview')
    return (
      <TeacherRun
        kind={kind}
        start={choice}
        onExit={() => setState('idle')}
        onQuick={() => setChoice({ mode: 'quick', family: null })}
      />
    );
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
      {sci ? null : (
        <Modes
          value={choice}
          families={families}
          onChange={(next) => {
            setChoice(next);
            if (state !== 'busy') setState('idle');
          }}
        />
      )}
      {state === 'noMistakes' ? (
        <NoMistakes onQuick={quick} />
      ) : (
        <div className="atlas-quiz-actions">
          <button
            type="button"
            className="btn btn-primary"
            id={sci ? 'start-sci-quiz-btn' : 'start-quiz-btn'}
            disabled={state === 'busy' || (choice.mode === 'family' && !choice.family)}
            onClick={() => void start()}
            data-testid="atlas-quiz-start"
          >
            {t('quiz.start')}
          </button>
          {extra}
        </div>
      )}
      {state === 'failed' ? (
        <p role="alert" style={{ marginTop: '1rem', color: 'var(--accent-red)' }}>
          {tf('serverError')}
        </p>
      ) : null}
    </div>
  );
}
