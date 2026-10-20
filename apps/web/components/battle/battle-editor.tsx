'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2, X } from 'lucide-react';
import {
  BATTLE_LIMITS,
  BATTLE_TIME_LIMITS,
  BattleQuestionDto,
  COVER_MIME,
  type Locale,
  LOCALES,
} from '@syntara/shared';
import {
  ANSWER_LETTERS,
  AnswerMarker,
  Button,
  Card,
  Checkbox,
  cn,
  EmptyState,
  Field,
  fieldClass,
  Input,
  Modal,
  SegmentedControl,
  Select,
  Skeleton,
  Textarea,
} from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { uploadFile } from '@/lib/upload';
import { useErrorText } from '../forms/form-parts';
import { type GalleryItem } from '../teacher/topic-cover';
import { PageHeader, StatusPill } from '../teacher/parts';
import { BATTLE_PAGE_WIDTH } from './teacher-battles';

type BattleQuiz = components['schemas']['BattleQuizDto'];
type ImportSource = components['schemas']['BattleImportSourceDto'];
type QuestionType = 'single_choice' | 'true_false';
type SaveState = 'saved' | 'saving' | 'invalid' | 'error';

interface Draft {
  /** Ключ React: id сохранённого вопроса или временный ключ нового. */
  key: string;
  id: string | null;
  type: QuestionType;
  text: string;
  imageMediaId: string | null;
  timeLimitSec: number;
  options: Array<{ text: string; isCorrect: boolean }>;
  imported: boolean;
  state: SaveState;
  errors: Record<string, string>;
}

const AUTOSAVE_MS = 700;
let draftSeq = 0;

const newDraft = (): Draft => ({
  key: `draft-${++draftSeq}`,
  id: null,
  type: 'single_choice',
  text: '',
  imageMediaId: null,
  timeLimitSec: 20,
  options: [
    { text: '', isCorrect: true },
    { text: '', isCorrect: false },
  ],
  imported: false,
  state: 'invalid',
  errors: {},
});

const fromServer = (q: BattleQuiz['questions'][number]): Draft => ({
  key: q.id,
  id: q.id,
  type: q.type,
  text: q.text,
  imageMediaId: q.imageMediaId,
  timeLimitSec: q.timeLimitSec,
  options: q.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect })),
  imported: q.imported,
  state: 'saved',
  errors: {},
});

/** Ошибки Zod (BattleQuestionDto) → { поле: ключ validation.* }. */
function validate(d: Draft): Record<string, string> {
  const res = BattleQuestionDto.safeParse(body(d));
  if (res.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of res.error.issues) {
    const path = issue.path.join('.');
    if (!errors[path]) errors[path] = issue.message;
  }
  return errors;
}
const body = (d: Draft) => ({
  type: d.type,
  text: d.text,
  imageMediaId: d.imageMediaId,
  timeLimitSec: d.timeLimitSec,
  options: d.options,
});

/**
 * BT-T02 «Редактор» (/teacher/battles/:id, REQ-BTL-T02): название, описание, язык; список вопросов
 * (перетаскивание и кнопки ↑↓); карточка вопроса — текст, картинка, тип, время, 2–4 варианта с цветом и фигурой
 * и переключателем «правильный»; «+ Вопрос», «Импорт из темы»; проверка перед запуском; автосохранение.
 */
export function BattleEditor({ battleId }: { battleId: string }) {
  const locale = useLocale();
  const key = ['teacher', 'battle', battleId];
  const quiz = useQuery({
    queryKey: key,
    queryFn: async () => {
      const res = await apiRequest<BattleQuiz>(`/api/teacher/battles/${battleId}`, { locale });
      if (res.kind !== 'ok') throw new Error('battle');
      return res.data;
    },
  });

  if (!quiz.data) {
    return (
      <section className={`mx-auto flex ${BATTLE_PAGE_WIDTH} flex-col gap-6 px-4 py-8`}>
        <Skeleton className="h-40" />
      </section>
    );
  }
  // Форма заполняется один раз из ответа api; дальше она — источник правды (автосохранение).
  return <EditorForm battleId={battleId} initial={quiz.data} />;
}

function EditorForm({ battleId, initial }: { battleId: string; initial: BattleQuiz }) {
  const t = useTranslations('battle.teacher.editor');
  const tl = useTranslations('locale');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const key = ['teacher', 'battle', battleId];
  const [meta, setMeta] = useState<{ title: string; description: string; locale: Locale }>(() => ({
    title: initial.title,
    description: initial.description ?? '',
    locale: initial.locale,
  }));
  const [metaState, setMetaState] = useState<SaveState>('saved');
  const [metaError, setMetaError] = useState<string | undefined>();
  const [drafts, setDrafts] = useState<Draft[]>(() => initial.questions.map(fromServer));
  const [announce, setAnnounce] = useState('');
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Актуальный список для отложенного сохранения; новый вопрос создаётся одним POST — повторы ждут его id.
  const draftsRef = useRef<Draft[] | null>(null);
  const creating = useRef(new Map<string, boolean>());
  const errorText = useErrorText();
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  const schedule = useCallback((id: string, fn: () => void) => {
    const old = timers.current.get(id);
    if (old) clearTimeout(old);
    timers.current.set(id, setTimeout(fn, AUTOSAVE_MS));
  }, []);

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((timer) => clearTimeout(timer));
  }, []);

  function changeMeta(patch: Partial<typeof meta>) {
    const next = { ...meta, ...patch };
    setMeta(next);
    if (!next.title.trim()) {
      setMetaState('invalid');
      return setMetaError('required');
    }
    setMetaError(undefined);
    setMetaState('saving');
    schedule('meta', async () => {
      const res = await apiRequest(`/api/teacher/battles/${battleId}`, {
        method: 'PATCH',
        body: { title: next.title.trim(), description: next.description.trim() || null, locale: next.locale },
        locale,
      });
      setMetaState(res.kind === 'ok' ? 'saved' : 'error');
      if (res.kind === 'http') setMetaError(Object.values(res.error.fieldErrors ?? {})[0]);
      // «Верно» / «Неверно» переписываются на новом языке (API-BTL-04) — подтягиваем их.
      if (res.kind === 'ok' && patch.locale) {
        const fresh = await apiRequest<BattleQuiz>(`/api/teacher/battles/${battleId}`, { locale });
        if (fresh.kind === 'ok')
          setDrafts((list) =>
            list.map((d) => {
              const server = fresh.data.questions.find((q) => q.id === d.id);
              return server && d.type === 'true_false' && d.state === 'saved' ? fromServer(server) : d;
            }),
          );
      }
    });
  }

  const update = (key: string, fn: (d: Draft) => Draft) =>
    setDrafts((list) => list.map((d) => (d.key === key ? fn(d) : d)));

  async function save(draft: Draft) {
    if (!draft.id && creating.current.has(draft.key)) {
      creating.current.set(draft.key, true);
      return;
    }
    if (!draft.id) creating.current.set(draft.key, false);
    const res = draft.id
      ? await apiRequest(`/api/teacher/battles/${battleId}/questions/${draft.id}`, {
          method: 'PATCH',
          body: body(draft),
          locale,
        })
      : await apiRequest<{ id: string }>(`/api/teacher/battles/${battleId}/questions`, {
          method: 'POST',
          body: body(draft),
          locale,
        });
    const createdId = !draft.id && res.kind === 'ok' ? (res.data as { id: string }).id : null;
    const resave = creating.current.get(draft.key) === true;
    creating.current.delete(draft.key);
    update(draft.key, (d) => ({
      ...d,
      id: d.id ?? createdId,
      state: res.kind === 'ok' ? (resave ? 'saving' : 'saved') : 'error',
      errors: res.kind === 'http' ? (res.error.fieldErrors ?? {}) : d.errors,
    }));
    // Правки, сделанные во время создания, — следующим PATCH.
    if (createdId && resave) {
      const latest = draftsRef.current?.find((d) => d.key === draft.key);
      if (latest) void save({ ...latest, id: createdId });
    }
  }

  function changeQuestion(key: string, patch: Partial<Draft>) {
    const current = drafts.find((d) => d.key === key)!;
    const next = { ...current, ...patch };
    const errors = validate(next);
    const valid = Object.keys(errors).length === 0;
    update(key, () => ({ ...next, errors, state: valid ? 'saving' : 'invalid' }));
    if (!valid) return;
    // Новый вопрос сохраняется сразу (POST один раз), правки — с задержкой.
    schedule(key, () => {
      const latest = draftsRef.current?.find((d) => d.key === key);
      if (latest) void save(latest);
    });
  }

  async function persistOrder(list: Draft[]) {
    const ids = list.filter((d) => d.id).map((d) => d.id!);
    if (ids.length < 2) return;
    await apiRequest(`/api/teacher/battles/${battleId}/questions/reorder`, {
      method: 'POST',
      body: { questionIds: ids },
      locale,
    });
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= drafts.length || from === to) return;
    const list = [...drafts];
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item!);
    setDrafts(list);
    setAnnounce(t('question', { number: to + 1 }));
    void persistOrder(list);
  }

  const [removing, setRemoving] = useState<number | null>(null);
  async function remove(index: number) {
    const draft = drafts[index]!;
    setRemoving(null);
    if (draft.id) {
      const res = await apiRequest(`/api/teacher/battles/${battleId}/questions/${draft.id}`, {
        method: 'DELETE',
        locale,
      });
      if (res.kind !== 'ok') return;
    }
    setDrafts((list) => list.filter((d) => d.key !== draft.key));
  }

  async function afterImport() {
    // Свежий тест с сервера (кеш запроса может быть старше импорта); несохранённые вопросы остаются в конце.
    const res = await apiRequest<BattleQuiz>(`/api/teacher/battles/${battleId}`, { locale });
    if (res.kind !== 'ok') return;
    queryClient.setQueryData(key, res.data);
    setDrafts((list) => {
      const unsaved = list.filter((d) => !d.id);
      return [...res.data.questions.map(fromServer), ...unsaved];
    });
  }

  const [dragFrom, setDragFrom] = useState<number | null>(null);

  const pending = drafts.some((d) => d.state === 'saving') || metaState === 'saving';
  const failed = drafts.some((d) => d.state === 'error') || metaState === 'error';
  const invalid = drafts.some((d) => d.state === 'invalid') || metaState === 'invalid';
  const notReady = drafts.map((d, i) => (d.state === 'invalid' || !d.id ? i + 1 : null)).filter(Boolean);

  return (
    <section
      className={`mx-auto flex ${BATTLE_PAGE_WIDTH} flex-col gap-6 px-4 py-8`}
      data-testid="battle-editor"
    >
      <PageHeader title={t('title')} back={{ href: '/teacher/battles', label: t('back') }} />
      <p
        role="status"
        aria-live="polite"
        className="text-sm text-[var(--text-muted)]"
        data-testid="battle-save-state"
      >
        {failed ? (
          <span className="text-[var(--danger-text)]">{t('saveError')}</span>
        ) : pending ? (
          t('saving')
        ) : invalid ? (
          t('unsaved')
        ) : (
          t('saved')
        )}
      </p>

      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <Field label={t('name')} required error={errorText(metaError)}>
          <Input
            value={meta.title}
            maxLength={BATTLE_LIMITS.title}
            onChange={(e) => changeMeta({ title: e.target.value })}
          />
        </Field>
        <Field label={t('description')}>
          <Textarea
            value={meta.description}
            maxLength={BATTLE_LIMITS.description}
            rows={2}
            onChange={(e) => changeMeta({ description: e.target.value })}
          />
        </Field>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] text-[var(--text-muted)]">{t('language')}</span>
          <SegmentedControl
            label={t('language')}
            value={meta.locale}
            onValueChange={(v) => changeMeta({ locale: v as Locale })}
            options={LOCALES.map((l) => ({ value: l, label: tl(`names.${l}`) }))}
          />
          <p className="text-xs text-[var(--text-muted)]">{t('languageHint')}</p>
        </div>
      </Card>

      <section aria-labelledby="battle-questions" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="battle-questions" className="text-cabinet-block font-semibold">
            {t('questions')}
          </h2>
          <div className="flex flex-wrap gap-2">
            <ImportButton battleId={battleId} onImported={() => void afterImport()} />
            <Button
              variant="primary-blue"
              disabled={drafts.length >= BATTLE_LIMITS.maxQuestions}
              onClick={() => setDrafts([...drafts, newDraft()])}
            >
              <Plus aria-hidden="true" className="size-4" />
              {t('addQuestion').replace(/^\+\s*/, '')}
            </Button>
          </div>
        </div>
        <p className="text-sm" data-testid="battle-readiness">
          {drafts.length === 0
            ? t('noQuestions')
            : notReady.length
              ? t('notReady', { numbers: notReady.join(', ') })
              : t('ready', { count: drafts.length })}
        </p>
        <span className="sr-only" aria-live="polite">
          {announce}
        </span>
        {drafts.length === 0 ? <EmptyState title={t('empty')} /> : null}
        <ol className="flex flex-col gap-3">
          {drafts.map((d, index) => (
            <li
              key={d.key}
              onDragOver={(e) => dragFrom !== null && e.preventDefault()}
              onDrop={() => {
                if (dragFrom !== null) move(dragFrom, index);
                setDragFrom(null);
              }}
            >
              <QuestionCard
                draft={d}
                number={index + 1}
                first={index === 0}
                last={index === drafts.length - 1}
                onChange={(patch) => changeQuestion(d.key, patch)}
                onMove={(dir) => move(index, index + dir)}
                onDragStart={() => setDragFrom(index)}
                onRemove={() => setRemoving(index)}
              />
            </li>
          ))}
        </ol>
      </section>

      <Modal
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('deleteTitle', { number: (removing ?? 0) + 1 })}
        description={t('deleteText')}
        closeLabel={t('cancel')}
      >
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={() => void remove(removing!)}>
            {t('deleteConfirm')}
          </Button>
          <Button variant="text" onClick={() => setRemoving(null)}>
            {t('cancel')}
          </Button>
        </div>
      </Modal>
    </section>
  );
}

function QuestionCard({
  draft,
  number,
  first,
  last,
  onChange,
  onMove,
  onDragStart,
  onRemove,
}: {
  draft: Draft;
  number: number;
  first: boolean;
  last: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onMove: (dir: -1 | 1) => void;
  onDragStart: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations('battle.teacher.editor');
  const tq = useTranslations('teacher.quiz');
  const errorText = useErrorText();
  const iconButton =
    'inline-flex size-11 items-center justify-center rounded-full border border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--field)] disabled:opacity-40';

  const setType = (type: QuestionType) =>
    onChange({
      type,
      options:
        type === 'true_false'
          ? [
              { text: tq('optionTrue'), isCorrect: draft.options[0]?.isCorrect ?? true },
              { text: tq('optionFalse'), isCorrect: !(draft.options[0]?.isCorrect ?? true) },
            ]
          : draft.options.map((o) => ({ ...o, text: draft.type === 'true_false' ? '' : o.text })),
    });
  const setOption = (i: number, patch: Partial<Draft['options'][number]>) =>
    onChange({ options: draft.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const markCorrect = (i: number) =>
    onChange({ options: draft.options.map((o, j) => ({ ...o, isCorrect: j === i })) });

  return (
    <Card className="flex flex-col gap-4 p-5" data-testid="battle-question" data-state={draft.state}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          draggable
          onDragStart={onDragStart}
          // Перетаскивание — для мыши; с клавиатуры порядок меняют кнопки ↑↓.
          aria-hidden="true"
          title={t('drag', { number })}
          className="inline-flex size-8 cursor-grab items-center justify-center text-[var(--text-muted)]"
        >
          <GripVertical aria-hidden="true" className="size-5" />
        </span>
        <h3 className="font-semibold">{t('question', { number })}</h3>
        {draft.imported ? <StatusPill tone="neutral">{t('imported')}</StatusPill> : null}
        {draft.state === 'invalid' || draft.state === 'error' ? (
          <StatusPill tone="danger">{t('unsaved')}</StatusPill>
        ) : null}
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            className={iconButton}
            disabled={first}
            onClick={() => onMove(-1)}
            aria-label={t('moveUp', { number })}
          >
            <ArrowUp aria-hidden="true" className="size-4" />
          </button>
          <button
            type="button"
            className={iconButton}
            disabled={last}
            onClick={() => onMove(1)}
            aria-label={t('moveDown', { number })}
          >
            <ArrowDown aria-hidden="true" className="size-4" />
          </button>
          <button
            type="button"
            className={iconButton}
            onClick={onRemove}
            aria-label={t('delete', { number })}
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </button>
        </div>
      </div>

      <Field label={t('questionText')} required error={errorText(draft.errors.text)}>
        <Textarea
          value={draft.text}
          rows={2}
          maxLength={BATTLE_LIMITS.questionText}
          onChange={(e) => onChange({ text: e.target.value })}
        />
      </Field>

      <ImagePicker
        value={draft.imageMediaId}
        onChange={(imageMediaId) => onChange({ imageMediaId })}
        error={draft.errors.imageMediaId}
      />

      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-[var(--text-muted)]">{t('type')}</span>
        <SegmentedControl
          label={t('type')}
          value={draft.type}
          onValueChange={(v) => setType(v as QuestionType)}
          options={(['single_choice', 'true_false'] as const).map((v) => ({
            value: v,
            label: tq(`types.${v}`),
          }))}
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-[var(--text-muted)]">{t('time')}</span>
        <SegmentedControl
          label={t('time')}
          value={String(draft.timeLimitSec)}
          onValueChange={(v) => onChange({ timeLimitSec: Number(v) })}
          options={BATTLE_TIME_LIMITS.map((n) => ({ value: String(n), label: t('seconds', { n }) }))}
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[13px] text-[var(--text-muted)]">{t('options')}</legend>
        {draft.options.map((o, i) => {
          const letter = ANSWER_LETTERS[i]!;
          return (
            <div key={i} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <AnswerMarker position={i + 1} />
              {draft.type === 'true_false' ? (
                <span className="min-h-[var(--field-h)] flex-1 content-center px-1">{o.text}</span>
              ) : (
                <input
                  aria-label={t('option', { letter })}
                  value={o.text}
                  maxLength={BATTLE_LIMITS.optionText}
                  onChange={(e) => setOption(i, { text: e.target.value })}
                  aria-invalid={draft.errors[`options.${i}.text`] ? true : undefined}
                  className={cn(fieldClass, 'min-w-0 flex-1', o.isCorrect && 'border-[var(--success)]')}
                />
              )}
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`correct-${draft.key}`}
                  checked={o.isCorrect}
                  onChange={() => markCorrect(i)}
                  aria-label={t('correctFor', { letter })}
                  className="size-5 accent-[var(--success)]"
                />
                <span aria-hidden="true">{t('correct')}</span>
              </label>
              {draft.type === 'single_choice' && draft.options.length > BATTLE_LIMITS.minOptions ? (
                <button
                  type="button"
                  onClick={() => onChange({ options: draft.options.filter((_, j) => j !== i) })}
                  aria-label={t('removeOption', { letter })}
                  className="inline-flex size-11 items-center justify-center rounded-full hover:bg-[var(--field)]"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              ) : null}
            </div>
          );
        })}
        {draft.errors.options ? (
          <p role="alert" className="text-xs text-[var(--danger-text)]">
            {errorText(draft.errors.options)}
          </p>
        ) : null}
        {draft.type === 'single_choice' && draft.options.length < BATTLE_LIMITS.maxOptions ? (
          <Button
            variant="text"
            className="self-start"
            onClick={() => onChange({ options: [...draft.options, { text: '', isCorrect: false }] })}
          >
            {t('addOption')}
          </Button>
        ) : null}
      </fieldset>
    </Card>
  );
}

/** Картинка вопроса — из галереи обложек учителя или новый файл (BR-BTL-10, BR-FILE-01/03). */
function ImagePicker({
  value,
  onChange,
  error,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  error?: string;
}) {
  const t = useTranslations('battle.teacher.editor');
  const tt = useTranslations('teacher.topic');
  const ts = useTranslations('teacher.topic.scan');
  const errorText = useErrorText();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>();
  const gallery = useQuery({
    queryKey: ['teacher', 'gallery'],
    queryFn: async () => {
      const res = await apiRequest<GalleryItem[]>('/api/teacher/gallery', { locale });
      if (res.kind !== 'ok') throw new Error('gallery');
      return res.data;
    },
    refetchInterval: (q) => (q.state.data?.some((g) => g.scanStatus === 'pending') ? 4000 : false),
  });

  async function upload(file: File) {
    setUploading(true);
    setUploadError(undefined);
    const res = await uploadFile(file, { kind: 'cover' }, locale);
    setUploading(false);
    if (!res.ok) return setUploadError(res.error);
    await queryClient.invalidateQueries({ queryKey: ['teacher', 'gallery'] });
    onChange(res.media.id);
  }

  const items = (gallery.data ?? []).filter((g) => g.scanStatus !== 'rejected');
  const message = errorText(uploadError ?? error);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-[13px] text-[var(--text-muted)]">{t('image')}</legend>
      <ul className="flex flex-wrap gap-2">
        <li>
          <button
            type="button"
            aria-pressed={value === null}
            onClick={() => onChange(null)}
            className={cn(
              'flex h-14 w-20 items-center justify-center rounded-[var(--radius-field)] border-2 bg-[var(--field)] px-1 text-center text-xs text-[var(--text-muted)]',
              value === null
                ? 'border-[var(--accent)]'
                : 'border-[var(--border)] hover:border-[var(--border-strong)]',
            )}
          >
            {t('imageNone')}
          </button>
        </li>
        {items.map((g) => (
          <li key={g.id}>
            <button
              type="button"
              aria-pressed={value === g.id}
              aria-label={tt('chooseCover', { name: g.name })}
              onClick={() => onChange(g.id)}
              className={cn(
                'flex h-14 w-20 items-center justify-center overflow-hidden rounded-[var(--radius-field)] border-2 bg-[var(--field)] text-xs text-[var(--text-muted)]',
                value === g.id
                  ? 'border-[var(--accent)]'
                  : 'border-[var(--border)] hover:border-[var(--border-strong)]',
              )}
            >
              {g.url ? <img src={g.url} alt="" className="size-full object-cover" /> : ts(g.scanStatus)}
            </button>
          </li>
        ))}
        <li>
          <Button
            variant="secondary"
            className="h-14"
            disabled={uploading}
            onClick={() => input.current?.click()}
          >
            {uploading ? tt('uploading') : tt('upload')}
          </Button>
          <input
            ref={input}
            type="file"
            hidden
            accept={COVER_MIME.join(',')}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void upload(file);
            }}
          />
        </li>
      </ul>
      {message ? (
        <p role="alert" className="text-xs text-[var(--danger-text)]">
          {message}
        </p>
      ) : null}
    </fieldset>
  );
}

/** «Импорт из темы» (BT-T02): предмет → тема → чекбоксы вопросов → API-BTL-11. */
function ImportButton({ battleId, onImported }: { battleId: string; onImported: () => void }) {
  const t = useTranslations('battle.teacher.import');
  const te = useTranslations('battle.teacher.editor');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [subjectId, setSubjectId] = useState<string>();
  const [topicId, setTopicId] = useState<string>();
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const sources = useQuery({
    queryKey: ['teacher', 'battle-import-sources', locale],
    enabled: open,
    queryFn: async () => {
      const res = await apiRequest<ImportSource[]>('/api/teacher/battles/import-sources', { locale });
      if (res.kind !== 'ok') throw new Error('sources');
      return res.data;
    },
  });
  const subject = sources.data?.find((s) => s.subjectId === subjectId);
  const topic = subject?.topics.find((tp) => tp.id === topicId);

  async function submit() {
    if (!topic || picked.length === 0) return;
    setBusy(true);
    const res = await apiRequest<{ imported: number }>(`/api/teacher/battles/${battleId}/import`, {
      method: 'POST',
      body: { topicId: topic.id, questionIds: picked },
      locale,
    });
    setBusy(false);
    if (res.kind !== 'ok')
      return setError(res.kind === 'http' ? Object.values(res.error.fieldErrors ?? {})[0] : 'required');
    setOpen(false);
    setPicked([]);
    onImported();
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setError(undefined);
      }}
      title={t('title')}
      closeLabel={tc('close')}
      trigger={<Button variant="secondary">{te('import')}</Button>}
    >
      <div className="mt-4 flex max-h-[70vh] flex-col gap-4 overflow-y-auto" data-testid="battle-import">
        {sources.isPending ? <Skeleton className="h-20" /> : null}
        {sources.data?.length === 0 ? <EmptyState title={t('empty')} /> : null}
        {sources.data?.length ? (
          <>
            <Field label={t('subject')}>
              <Select
                value={subjectId}
                placeholder={t('choose')}
                onValueChange={(v) => {
                  setSubjectId(v);
                  setTopicId(undefined);
                  setPicked([]);
                }}
                options={sources.data.map((s) => ({
                  value: s.subjectId,
                  label: s.official ? `${s.subjectTitle} · ${t('official')}` : s.subjectTitle,
                }))}
              />
            </Field>
            {subject ? (
              <Field label={t('topic')}>
                <Select
                  value={topicId}
                  placeholder={t('choose')}
                  onValueChange={(v) => {
                    setTopicId(v);
                    setPicked(subject.topics.find((tp) => tp.id === v)?.questions.map((q) => q.id) ?? []);
                  }}
                  options={subject.topics.map((tp) => ({
                    value: tp.id,
                    label: `${tp.title} (${tp.eligibleCount})`,
                  }))}
                />
              </Field>
            ) : null}
            {topic ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-[13px] text-[var(--text-muted)]">{t('questions')}</legend>
                <Checkbox
                  label={t('all')}
                  checked={picked.length === topic.questions.length}
                  onCheckedChange={(c) => setPicked(c ? topic.questions.map((q) => q.id) : [])}
                />
                {topic.questions.map((q) => (
                  <Checkbox
                    key={q.id}
                    label={q.text}
                    checked={picked.includes(q.id)}
                    onCheckedChange={(c) =>
                      setPicked((p) => (c ? [...p, q.id] : p.filter((id) => id !== q.id)))
                    }
                  />
                ))}
              </fieldset>
            ) : null}
            {error ? (
              <p role="alert" className="text-xs text-[var(--danger-text)]">
                {errorText(error)}
              </p>
            ) : null}
            <Button
              variant="primary-blue"
              className="self-start"
              disabled={!topic || picked.length === 0 || busy}
              onClick={() => void submit()}
            >
              {t('submit')}
            </Button>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
