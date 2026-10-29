'use client';

import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { MASTERY_THRESHOLD, percentDelta, segmentState } from '@syntara/shared';
import { AppLink } from '../../app-link';
import {
  canHint,
  type Difficulty,
  hasHint,
  type RunSource,
  type RunSummary,
  type TestRun,
  useTestKeys,
  useTestRun,
} from '../../learn/test-run';
import { type AtlasElement, GROUP_COLORS } from './atlas-data';
import { BohrDiagram, TablePick } from './table-pick';

const LETTERS = 'ABCDEFGH';
const DOTS: Record<Difficulty, number> = { easy: 1, medium: 2, hard: 3 };

/** Куда ведут «К уроку» / «К атласу» и «× Завершить» (REQ-TST-05.4, REQ-TST-06.2). */
export interface AtlasTestPlacement {
  /** Подпись кнопки возврата: тест элемента и учёных — «К уроку», квиз и игра — «К атласу». */
  back: 'toLesson' | 'toAtlas';
  backHref: string;
  onExit: () => void;
  /** Прогресс сохраняется при выходе (незавершённая попытка теста темы продолжается, BR-QZ-06). */
  exitSaved: boolean;
}

/**
 * Тест в стиле атласа (docs/TESTS_TZ.md, T1; решение владельца 5 — тёмный фон, свечение, цвета семейств, шрифты
 * атласа): общий движок (learn/test-run.ts) — та же логика, что у теста платформы. Компьютер — две колонки (вопрос и
 * «Ход попытки»), узкий контейнер — одна колонка, «Ход попытки» сверху строкой (REQ-TST-06). `intro` — заголовок
 * вопроса («Какой это элемент?»; у квиза атласа заголовок приходит с вопросом), `accent` — цвет мягкого свечения
 * верного ответа (цвет семейства элемента; рамка и галочка — зелёные). `elements` — элементы с уроками для вопроса
 * «Найдите на таблице» (REQ-TST-10.3).
 */
export function AtlasTestRun({
  source,
  placement,
  intro,
  accent,
  onRetry,
  onRetryMistakes,
  testId,
  elements = [],
}: {
  source: RunSource;
  placement: AtlasTestPlacement;
  intro?: string;
  accent?: string;
  elements?: AtlasElement[];
  onRetry: () => void;
  /** «Повторить ошибки»: по умолчанию — как «Пройти ещё раз» (тест темы — новая попытка той же темы). */
  onRetryMistakes?: (summary: RunSummary) => void;
  testId: string;
}) {
  const t = useTranslations('test');
  const tf = useTranslations('forms');
  const queryClient = useQueryClient();
  const run = useTestRun(source);
  const [exit, setExit] = useState(false);
  useTestKeys(run, run.phase === 'question' && !exit);

  useEffect(() => {
    if (run.phase !== 'finished' || run.preview) return;
    // Хедер: XP и серия (API-S-16); статусы тем атласа.
    void queryClient.invalidateQueries({ queryKey: ['me', 'stats'] });
    void queryClient.invalidateQueries({ queryKey: ['atlas'] });
  }, [run.phase, run.preview, queryClient]);

  if (run.phase === 'failed')
    return (
      <p role="alert" className="ai-placeholder">
        {tf('serverError')}
      </p>
    );
  if (run.phase === 'finished' && run.summary)
    return (
      <AtlasTestResult
        summary={run.summary}
        preview={run.preview}
        placement={placement}
        onRetry={onRetry}
        onRetryMistakes={onRetryMistakes ? () => onRetryMistakes(run.summary!) : onRetry}
        testId={testId}
      />
    );
  if (run.phase === 'loading' || !run.question)
    return (
      <div className="typing-indicator" role="status" aria-label="…">
        <span />
        <span />
        <span />
      </div>
    );

  return (
    <div className="atest fade-in" data-testid={testId}>
      <div className="atest-top">
        <button type="button" className="atest-exit" onClick={() => setExit(true)} data-testid="atest-exit">
          <span aria-hidden="true">×</span> {t('exit')}
        </button>
      </div>
      {exit ? (
        <ExitConfirm
          saved={placement.exitSaved}
          onCancel={() => setExit(false)}
          onConfirm={() => {
            setExit(false);
            placement.onExit();
          }}
        />
      ) : null}
      <div className="atest-grid">
        <Panel run={run} />
        <div className="atest-main">
          <Question
            key={run.question.id}
            run={run}
            intro={run.question.intro ?? intro}
            accent={run.result?.accent ?? accent}
            elements={elements}
          />
        </div>
      </div>
    </div>
  );
}

/** «× Завершить» (REQ-TST-06.2): подтверждение в стиле атласа; Esc — отмена, фокус на «Продолжить тест». */
function ExitConfirm({
  saved,
  onCancel,
  onConfirm,
}: {
  saved: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations('test');
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div
      className="atest-confirm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="atest-confirm-title"
      aria-describedby="atest-confirm-text"
      data-testid="atest-exit-dialog"
    >
      <div className="atest-confirm-card">
        <h3 id="atest-confirm-title">{t('exitTitle')}</h3>
        <p id="atest-confirm-text">{saved ? t('exitSaved') : t('exitLost')}</p>
        <div className="atest-confirm-actions">
          <button ref={cancel} type="button" className="btn btn-secondary" onClick={onCancel}>
            {t('exitCancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            data-testid="atest-exit-confirm"
          >
            {t('exit')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** «Ход попытки» (REQ-TST-02): полоса, «Вопрос k из N», серия от 2, сложность, сообщение о смене уровня, «50/50». */
function Panel({ run }: { run: TestRun }) {
  const t = useTranslations('test');
  const q = run.question!;
  const showHint = hasHint(q);
  return (
    <aside className="atest-panel" aria-label={t('panel')} data-testid="atest-panel">
      <h4 className="atest-panel-title">{t('panel')}</h4>
      <ol className="atest-segments" aria-label={t('segments')} data-testid="atest-segments">
        {Array.from({ length: run.total }, (_, i) => {
          const state = segmentState(run.marks[i], i === run.position);
          return (
            <li key={i} data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
              <span className="atlas-sr-only">{t(`segment.${state}`, { index: i + 1 })}</span>
            </li>
          );
        })}
      </ol>
      <p className="atest-progress" data-testid="atest-progress">
        {t('progress', { index: run.position + 1, count: run.total })}
      </p>
      {run.streak >= 2 ? (
        <p className="atest-streak" data-testid="atest-streak">
          <span aria-hidden="true">🔥</span> {t('streak', { count: run.streak })}
        </p>
      ) : null}
      <p
        className="atest-difficulty"
        data-level={q.difficulty}
        title={run.adaptive ? t('difficulty.adaptive') : undefined}
        data-testid="atest-difficulty"
      >
        <span className="atest-dots" aria-hidden="true">
          {[1, 2, 3].map((n) => (
            <span key={n} data-on={n <= DOTS[q.difficulty] ? 'true' : undefined} />
          ))}
        </span>
        <span className="atlas-sr-only">{t('difficulty.label')}: </span>
        <span>{t(`difficulty.${q.difficulty}`)}</span>
      </p>
      {run.adaptive ? <p className="atest-note">{t('difficulty.adaptive')}</p> : null}
      <p className="atest-level" role="status" data-testid="atest-level">
        {run.notice && !run.result ? (run.notice === 'up' ? t('levelUp') : t('levelDown')) : ''}
      </p>
      {showHint ? (
        <button
          type="button"
          className="atest-hint"
          disabled={!canHint(q, run.hintsLeft, Boolean(run.result)) || run.busy}
          aria-label={`${t('hintLabel')}. ${t('hintLeft', { count: run.hintsLeft })}`}
          onClick={() => void run.hint()}
          data-testid="atest-hint"
        >
          {t('hintLeft', { count: run.hintsLeft })}
        </button>
      ) : null}
    </aside>
  );
}

function Question({
  run,
  intro,
  accent,
  elements,
}: {
  run: TestRun;
  intro?: string | null;
  accent?: string | null;
  elements: AtlasElement[];
}) {
  const t = useTranslations('test');
  const q = run.question!;
  const result = run.result;
  const [text, setText] = useState('');
  const nextButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (result) nextButton.current?.focus();
  }, [result]);
  const trueFalse = q.type === 'true_false';
  const table = q.type === 'table_pick';
  const style = { '--atest-accent': accent ?? 'var(--success)' } as CSSProperties;

  return (
    <div className="atest-question" style={style}>
      {intro ? (
        <h3 className="quiz-question-intro" id={`atq-${q.id}`}>
          {intro}
        </h3>
      ) : null}
      <p className="atest-text" id={intro ? `atq-${q.id}-text` : `atq-${q.id}`} data-testid="atest-question">
        {q.text}
      </p>
      {q.shells?.length ? <BohrDiagram shells={q.shells} /> : null}
      <p id={`atk-${q.id}`} className="atlas-sr-only">
        {trueFalse ? t('trueFalseHint') : table ? null : t('keyboardHint')}
      </p>
      {table ? (
        <>
          <TablePick
            elements={elements}
            selected={run.selected}
            onSelect={run.setSelected}
            rows={q.rows ?? []}
            correctId={result?.correctOptionId ?? null}
            chosenId={result ? result.optionId : null}
            disabled={Boolean(result) || run.busy}
            labelledBy={intro ? `atq-${q.id}-text` : `atq-${q.id}`}
          />
          {result ? null : (
            <button
              type="button"
              className="btn btn-primary atest-submit"
              disabled={!run.selected || run.busy}
              onClick={() => run.selected && void run.submit({ optionId: run.selected })}
              data-testid="atest-submit"
            >
              {t('answer')}
            </button>
          )}
        </>
      ) : q.type === 'text_input' ? (
        <form
          className="atest-input-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim() && !result) void run.submit({ textAnswer: text });
          }}
        >
          <label htmlFor={`ati-${q.id}`} className="atlas-sr-only">
            {t('answerLabel')}
          </label>
          <input
            id={`ati-${q.id}`}
            className="atest-input"
            data-state={result ? (result.correct ? 'correct' : 'wrong') : undefined}
            value={result?.textAnswer ?? text}
            onChange={(e) => setText(e.target.value)}
            disabled={Boolean(result) || run.busy}
            placeholder={t('answerLabel')}
            maxLength={300}
            autoComplete="off"
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={Boolean(result) || run.busy || !text.trim()}
          >
            {t('answer')}
          </button>
        </form>
      ) : (
        <div
          className={`atest-options${trueFalse ? ' atest-tf' : ''}`}
          role="group"
          aria-labelledby={`atq-${q.id}`}
          aria-describedby={`atk-${q.id}`}
        >
          {q.options.map((o, i) => {
            const removed = q.removed.includes(o.id);
            const state = result
              ? result.correctOptionId === o.id
                ? 'correct'
                : result.optionId === o.id
                  ? 'wrong'
                  : 'idle'
              : removed
                ? 'removed'
                : run.selected === o.id
                  ? 'selected'
                  : 'idle';
            return (
              <button
                key={o.id}
                type="button"
                className="atest-opt"
                data-state={state}
                data-option-id={o.id}
                aria-pressed={run.selected === o.id || result?.optionId === o.id}
                aria-disabled={result || removed ? true : undefined}
                // Клик сразу отправляет ответ (как в оригинале и в тесте платформы); клавиши 1–4 / A–D — только выбор.
                onClick={() => !result && !removed && void run.submit({ optionId: o.id })}
                data-testid="atest-option"
              >
                {trueFalse ? null : (
                  <span className="atest-letter" aria-hidden="true">
                    {LETTERS[i]}
                  </span>
                )}
                <span className="atest-opt-text">{o.text}</span>
                {removed ? <span className="atlas-sr-only"> ({t('removed')})</span> : null}
                {/* Верно / неверно — не только цветом (свечение семейства может быть красноватым). */}
                {state === 'correct' ? (
                  <span className="atest-mark" aria-hidden="true">
                    ✓
                  </span>
                ) : state === 'wrong' ? (
                  <span className="atest-mark" aria-hidden="true">
                    ✗
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
      <div className="atest-feedback" aria-live="polite" data-testid="atest-feedback">
        {q.removed.length && !result ? <p className="atlas-sr-only">{t('hintUsed')}</p> : null}
        {result ? (
          <div className="atest-verdict" data-state={result.correct ? 'correct' : 'wrong'}>
            <p className="atest-verdict-title">{result.correct ? t('correct') : t('incorrect')}</p>
            {result.caseHint ? (
              <p className="atest-case" data-testid="atest-case">
                {t('caseHint')}
              </p>
            ) : null}
            {result.correctAnswer && !result.correct ? (
              <p>{t('correctAnswer', { answer: result.correctAnswer })}</p>
            ) : null}
            {result.explanation ? (
              <p className="atest-explanation" data-testid="atest-explanation">
                {result.explanation}
              </p>
            ) : null}
            {result.lessonHref ? (
              <AppLink
                href={result.lessonHref}
                scroll={false}
                className="atest-link"
                data-testid="atest-lesson"
              >
                {t('openLesson')}
              </AppLink>
            ) : null}
          </div>
        ) : null}
      </div>
      {result ? (
        <button
          ref={nextButton}
          type="button"
          className="btn btn-primary atest-next"
          onClick={run.next}
          disabled={run.busy}
          data-testid="atest-next"
        >
          {t('next')}
        </button>
      ) : null}
    </div>
  );
}

/** REQ-TST-05 в стиле атласа: круг с процентом и свечением, XP, сравнение, семейства, ошибки, действия. */
function AtlasTestResult({
  summary,
  preview,
  placement,
  onRetry,
  onRetryMistakes,
  testId,
}: {
  summary: RunSummary;
  preview: boolean;
  placement: AtlasTestPlacement;
  onRetry: () => void;
  onRetryMistakes: () => void;
  testId: string;
}) {
  const t = useTranslations('test');
  const ta = useTranslations('atlas');
  const tq = useTranslations('student.quiz');
  const tp = useTranslations('student.periodicTable.families');
  const delta = percentDelta(summary.percent, summary.previousPercent);
  const r = 52;
  const c = 2 * Math.PI * r;
  const ring =
    summary.percent >= 80
      ? 'var(--success)'
      : summary.percent >= 50
        ? 'var(--accent-gold)'
        : 'var(--accent-red)';
  return (
    <div className="atest-result fade-in-up" data-testid={`${testId}-result`}>
      <div className="atest-result-head">
        <svg
          viewBox="0 0 120 120"
          className="atest-ring"
          role="img"
          aria-label={t('result.chart', { percent: summary.percent })}
          style={{ '--ring': ring } as CSSProperties}
        >
          <circle cx="60" cy="60" r={r} className="atest-ring-track" />
          <circle
            cx="60"
            cy="60"
            r={r}
            className="atest-ring-value"
            strokeDasharray={`${(c * summary.percent) / 100} ${c}`}
            transform="rotate(-90 60 60)"
          />
          <text x="60" y="60" textAnchor="middle" dominantBaseline="central">
            {summary.percent}%
          </text>
        </svg>
        <div className="atest-result-info">
          <h2 className="hero-title atest-result-title">
            {t('result.score', { correct: summary.correct, total: summary.total })}
          </h2>
          <p className="hero-subtitle">
            {summary.percent >= 80 ? ta('quiz.excellent') : ta('quiz.keepLearning')}
          </p>
          {summary.mastered !== null ? (
            <p className="atest-muted" data-testid={`${testId}-mastery`}>
              {summary.mastered ? tq('masteredYes') : tq('masteredNo', { threshold: MASTERY_THRESHOLD })}
            </p>
          ) : null}
          {summary.hinted ? (
            <p className="atest-muted">{t('result.hinted', { count: summary.hinted })}</p>
          ) : null}
          {/* «+N XP» — фактически начисленное (BR-XP-01, BR-XP-05); учителю — без XP и сравнения. */}
          {preview ? null : (
            <>
              <p className="atlas-xp" data-testid={`${testId}-xp`}>
                {tq('xp', { xp: summary.xpAwarded })}
              </p>
              <p className="atest-compare" data-testid={`${testId}-compare`}>
                {summary.bestPercent !== null ? (
                  <span>{t('result.best', { percent: summary.bestPercent })}</span>
                ) : null}
                {delta !== null ? (
                  <span data-sign={delta > 0 ? 'up' : delta < 0 ? 'down' : undefined}>
                    {t('result.delta', { delta: `${delta >= 0 ? '+' : ''}${delta}` })}
                  </span>
                ) : null}
              </p>
            </>
          )}
        </div>
      </div>
      {summary.badges.length ? (
        <p className="atest-muted">
          {tq('badges')}: {summary.badges.map((b) => b.title).join(', ')}
        </p>
      ) : null}
      {summary.families.length ? (
        <section className="atest-families" data-testid={`${testId}-families`}>
          <h3>{t('result.families')}</h3>
          <ul>
            {summary.families.map((f) => (
              <li key={f.family} style={{ '--fam': GROUP_COLORS[f.family] ?? '#888' } as CSSProperties}>
                <span className="atest-fam-dot" aria-hidden="true" />
                {t('result.family', { family: tp(f.family), correct: f.correct, total: f.total })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {summary.mistakes.length ? (
        <section className="atest-mistakes" data-testid={`${testId}-mistakes`}>
          <h3>{t('result.mistakes')}</h3>
          <ul>
            {summary.mistakes.map((m, i) => (
              <li key={i}>
                <p className="atest-mistake-q">{m.question}</p>
                <p className="atest-wrong">{t('result.yours', { answer: m.yours })}</p>
                <p className="atest-right">{t('result.right', { answer: m.correct })}</p>
                {m.explanation ? (
                  <details>
                    <summary>{t('result.explanation')}</summary>
                    <p>{m.explanation}</p>
                  </details>
                ) : null}
                {m.href ? (
                  <AppLink href={m.href} className="atest-link">
                    {t('openLesson')}
                  </AppLink>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ResultActions>
        {summary.mistakes.length ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={onRetryMistakes}
            data-testid={`${testId}-retry-mistakes`}
          >
            {t('result.retryMistakes')}
          </button>
        ) : null}
        <button
          type="button"
          className={`btn ${summary.mistakes.length ? 'btn-secondary' : 'btn-primary'}`}
          onClick={onRetry}
          data-testid={`${testId}-retry`}
        >
          {t('result.retry')}
        </button>
        <AppLink
          href={placement.backHref}
          scroll={false}
          className="btn btn-secondary"
          data-testid={`${testId}-back`}
        >
          {t(`result.${placement.back}`)}
        </AppLink>
      </ResultActions>
    </div>
  );
}

function ResultActions({ children }: { children: ReactNode }) {
  return <div className="atest-actions">{children}</div>;
}
