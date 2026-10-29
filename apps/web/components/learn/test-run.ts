'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { answerStreak, HINT_MIN_OPTIONS } from '@syntara/shared';

/**
 * Общая логика прохождения теста (docs/TESTS_TZ.md, T1; решение владельца 3.2 — «логика общая»): тест темы любого
 * предмета, тест элемента и учёных атласа, квиз «Проверь знания», игра «Кто этот учёный?». Оформление — отдельно:
 * платформа (`quiz.tsx`, packages/ui) и атлас (`atlas-chemistry/test-view.tsx`, стиль атласа). Источник вопросов и
 * проверки — `RunSource`: ученик — сервер (правильный ответ только после ответа, BR-QZ-01; подсказку выбирает и
 * записывает сервер, BR-TST-01), учитель — предпросмотр без записи.
 */

/** `table_pick` — клик по ячейке таблицы Менделеева (квиз атласа, REQ-TST-10). */
export type QuestionType = 'single_choice' | 'true_false' | 'text_input' | 'table_pick';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface RunQuestion {
  id: string;
  type: QuestionType;
  difficulty: Difficulty;
  text: string;
  options: Array<{ id: string; text: string }>;
  /** REQ-TST-04: варианты, убранные «50/50». */
  removed: string[];
  /** Квиз атласа (REQ-TST-10): заголовок над текстом, схема Бора (электроны по оболочкам), «50/50» таблицы — периоды. */
  intro?: string | null;
  shells?: number[] | null;
  rows?: number[];
}

export interface RunResult {
  correct: boolean;
  hinted: boolean;
  correctOptionId: string | null;
  correctAnswer: string | null;
  explanation: string | null;
  /** «Открыть урок →» (REQ-TST-01): урок темы, окно элемента или раздел учёного. */
  lessonHref: string | null;
  /** Цвет свечения верного ответа (атлас — цвет семейства элемента). */
  accent?: string | null;
  optionId: string | null;
  textAnswer: string | null;
  /** «Впишите символ»: верные буквы, но не тот регистр — «Обратите внимание на заглавную букву» (REQ-TST-10). */
  caseHint?: boolean;
}

export interface RunMark {
  correct: boolean;
  hinted: boolean;
}

export interface RunMistake {
  question: string;
  yours: string;
  correct: string;
  explanation: string | null;
  href: string | null;
}

export interface RunSummary {
  correct: number;
  total: number;
  percent: number;
  /** Верных с подсказкой (REQ-TST-05.1). */
  hinted: number;
  xpAwarded: number;
  /** REQ-TST-05.2: null — у учителя (ничего не записывается). */
  bestPercent: number | null;
  previousPercent: number | null;
  badges: Array<{ code: string; title: string }>;
  /** Тест темы: освоена ли (PH-38); у квиза атласа и учителя — null. */
  mastered: boolean | null;
  families: Array<{ family: string; correct: number; total: number }>;
  mistakes: RunMistake[];
}

export interface RunSnapshot {
  /** Известные вопросы: тест темы — все, квиз атласа — текущий (следующий приходит с ответом). */
  questions: RunQuestion[];
  /** Уже данные ответы по порядку (продолжение попытки). */
  marks: RunMark[];
  results: Record<string, RunResult>;
  total: number;
  hintsLeft: number;
}

export interface RunSource {
  preview: boolean;
  /** Сложность меняется по ответам (квиз и игра атласа) — индикатор и сообщение о смене (REQ-TST-02.3). */
  adaptive: boolean;
  load(): Promise<RunSnapshot | null>;
  answer(
    question: RunQuestion,
    body: { optionId?: string; textAnswer?: string },
  ): Promise<{ result: RunResult; next: RunQuestion | null } | null>;
  hint(question: RunQuestion): Promise<{ removed: string[]; rows?: number[]; hintsLeft: number } | null>;
  finish(): Promise<RunSummary | null>;
}

const LEVEL: Record<Difficulty, number> = { easy: 1, medium: 2, hard: 3 };

/** У вопроса есть «50/50»: выбор из 4+ вариантов или таблица (подсветка двух периодов, REQ-TST-10.3). */
export const hasHint = (q: RunQuestion) =>
  q.type === 'table_pick' || (q.type === 'single_choice' && q.options.length >= HINT_MIN_OPTIONS);

/** «50/50» доступна (REQ-TST-04): у вопроса есть подсказка, она ещё не взята к нему и не исчерпана. */
export function canHint(q: RunQuestion, hintsLeft: number, answered: boolean): boolean {
  return !answered && hasHint(q) && q.removed.length === 0 && !q.rows?.length && hintsLeft > 0;
}

export type RunPhase = 'loading' | 'question' | 'finished' | 'failed';

export function useTestRun(source: RunSource) {
  const [phase, setPhase] = useState<RunPhase>('loading');
  const [questions, setQuestions] = useState<RunQuestion[]>([]);
  const [marks, setMarks] = useState<RunMark[]>([]);
  const [results, setResults] = useState<Record<string, RunResult>>({});
  const [index, setIndex] = useState(0);
  const [total, setTotal] = useState(0);
  const [hintsLeft, setHintsLeft] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [notice, setNotice] = useState<'up' | 'down' | null>(null);
  const pending = useRef<RunQuestion | null>(null);
  const lock = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void source.load().then((snap) => {
      if (cancelled) return;
      if (!snap) return setPhase('failed');
      setQuestions(snap.questions);
      setMarks(snap.marks);
      setResults(snap.results);
      setTotal(snap.total);
      setHintsLeft(snap.hintsLeft);
      // Продолжение: первый вопрос без ответа; все отвечены — сразу результат.
      const first = snap.questions.findIndex((q) => !snap.results[q.id]);
      if (first === -1 && snap.marks.length >= snap.total) return void complete();
      setIndex(first === -1 ? snap.questions.length - 1 : first);
      setPhase('question');
    });
    return () => {
      cancelled = true;
    };
  }, [source]);

  const question = questions[index] ?? null;
  const result = question ? (results[question.id] ?? null) : null;
  const position = marks.length - (result ? 1 : 0);

  async function complete() {
    setBusy(true);
    const res = await source.finish();
    setBusy(false);
    if (!res) return setPhase('failed');
    setSummary(res);
    setPhase('finished');
  }

  const submit = useCallback(
    async (body: { optionId?: string; textAnswer?: string }) => {
      if (!question || result || lock.current) return;
      lock.current = true;
      setBusy(true);
      const res = await source.answer(question, body);
      lock.current = false;
      setBusy(false);
      if (!res) return setPhase('failed');
      setResults((prev) => ({ ...prev, [question.id]: res.result }));
      setMarks((prev) => [...prev, { correct: res.result.correct, hinted: res.result.hinted }]);
      pending.current = res.next;
    },
    [question, result, source],
  );

  const next = useCallback(() => {
    if (!question || !result || busy) return;
    const nextQuestion = pending.current ?? questions[index + 1] ?? null;
    pending.current = null;
    setSelected(null);
    if (!nextQuestion || marks.length >= total) return void complete();
    if (source.adaptive) {
      const diff = LEVEL[nextQuestion.difficulty] - LEVEL[question.difficulty];
      setNotice(diff > 0 ? 'up' : diff < 0 ? 'down' : null);
    }
    if (!questions.some((q) => q.id === nextQuestion.id)) setQuestions((prev) => [...prev, nextQuestion]);
    setIndex(questions.findIndex((q) => q.id === nextQuestion.id) === -1 ? questions.length : index + 1);
  }, [question, result, busy, questions, index, marks.length, total, source.adaptive]);

  const hint = useCallback(async () => {
    if (!question || !canHint(question, hintsLeft, Boolean(result)) || lock.current) return;
    lock.current = true;
    const res = await source.hint(question);
    lock.current = false;
    if (!res) return;
    setHintsLeft(res.hintsLeft);
    setQuestions((prev) =>
      prev.map((q) => (q.id === question.id ? { ...q, removed: res.removed, rows: res.rows ?? q.rows } : q)),
    );
    if (selected && res.removed.includes(selected)) setSelected(null);
  }, [question, hintsLeft, result, source, selected]);

  return {
    phase,
    question,
    result,
    /** Номер текущего вопроса с 0 (по числу данных ответов). */
    position,
    total,
    marks,
    results,
    questions,
    hintsLeft,
    selected,
    setSelected,
    busy,
    summary,
    notice,
    streak: answerStreak(marks),
    preview: source.preview,
    adaptive: source.adaptive,
    submit,
    next,
    hint,
  };
}

export type TestRun = ReturnType<typeof useTestRun>;

/** Вариант можно выбрать: не убран подсказкой. */
export const selectable = (q: RunQuestion) => q.options.filter((o) => !q.removed.includes(o.id));

const KEYS = 'abcdefgh';

/**
 * REQ-TST-03: клавиши 1–4 или A–D выбирают вариант («Верно/Неверно» — 1/2), Enter — ответить или «Далее». Поле ввода,
 * кнопки, ссылки и радиокнопки обрабатывают Enter сами; при открытом подтверждении выхода клавиши выключены (`enabled`).
 */
export function useTestKeys(run: TestRun, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'TEXTAREA' || (tag === 'INPUT' && (target as HTMLInputElement).type !== 'radio')) return;
      const q = run.question;
      if (!q) return;
      if (e.key === 'Enter') {
        if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT') return;
        e.preventDefault();
        if (run.result) run.next();
        else if (run.selected) void run.submit({ optionId: run.selected });
        return;
      }
      if (run.result || q.type === 'text_input' || q.type === 'table_pick') return;
      const key = e.key.toLowerCase();
      const i = /^[1-9]$/.test(key) ? Number(key) - 1 : KEYS.indexOf(key);
      if (i < 0 || i >= q.options.length) return;
      const option = q.options[i]!;
      if (q.removed.includes(option.id)) return;
      e.preventDefault();
      run.setSelected(option.id);
      document.querySelector<HTMLElement>(`[data-option-id="${CSS.escape(option.id)}"]`)?.focus();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [run, enabled]);
}
