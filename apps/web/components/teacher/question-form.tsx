'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { X } from 'lucide-react';
import { type Locale, LOCALES, QuestionDto } from '@syntara/shared';
import { Button, cn, Field, fieldClass, Input, SegmentedControl, Textarea } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { useErrorText } from '../forms/form-parts';
import { issuesByPath } from './parts';
import { LanguageTabs } from './parts';

type QuestionItem = components['schemas']['QuestionItemDto'];
type QuestionType = 'single_choice' | 'true_false' | 'text_input';
type Difficulty = 'easy' | 'medium' | 'hard';
type Texts = Record<Locale, string>;

export interface QuestionValues {
  type: QuestionType;
  difficulty: Difficulty;
  translations: Record<Locale, { text: string; explanation: string }>;
  options: Array<{ translations: Texts }>;
  /** Индекс правильного варианта: правильность одна для всех языков (REQ-TCH-QZ-03). */
  correct: number | null;
  textAnswer: string;
}

const MAX_OPTIONS = 8;
const emptyTexts = (): Texts => ({ ru: '', kk: '', en: '' });

export function emptyQuestion(): QuestionValues {
  return {
    type: 'single_choice',
    difficulty: 'easy',
    translations: {
      ru: { text: '', explanation: '' },
      kk: { text: '', explanation: '' },
      en: { text: '', explanation: '' },
    },
    options: [{ translations: emptyTexts() }, { translations: emptyTexts() }],
    correct: null,
    textAnswer: '',
  };
}

export function valuesOf(q: QuestionItem): QuestionValues {
  const v = emptyQuestion();
  v.type = q.type;
  v.difficulty = q.difficulty;
  for (const l of LOCALES) {
    const tr = q.translations[l];
    if (tr) v.translations[l] = { text: tr.text ?? '', explanation: tr.explanation ?? '' };
  }
  if (q.type === 'single_choice') {
    v.options = q.options.map((o) => ({ translations: { ...emptyTexts(), ...o.translations } }));
  }
  const correct = q.options.findIndex((o) => o.isCorrect);
  v.correct = correct >= 0 ? correct : null;
  v.textAnswer = q.textAnswer ?? '';
  return v;
}

/** Тело QuestionDto (6.7): только заполненные языки. */
function toDto(v: QuestionValues) {
  const translations = Object.fromEntries(
    LOCALES.flatMap((l) => {
      const { text, explanation } = v.translations[l];
      return text.trim() || explanation.trim()
        ? [[l, { text, ...(explanation.trim() ? { explanation } : {}) }]]
        : [];
    }),
  );
  const nonEmpty = (t: Texts) => Object.fromEntries(LOCALES.flatMap((l) => (t[l].trim() ? [[l, t[l]]] : [])));
  const options =
    v.type === 'single_choice'
      ? v.options.map((o, i) => ({ translations: nonEmpty(o.translations), isCorrect: i === v.correct }))
      : v.type === 'true_false'
        ? [0, 1].map((i) => ({ translations: {}, isCorrect: i === v.correct }))
        : undefined;
  return {
    type: v.type,
    difficulty: v.difficulty,
    translations,
    ...(options ? { options } : {}),
    ...(v.type === 'text_input' ? { textAnswer: v.textAnswer } : {}),
  };
}

/**
 * Вопрос квиза (8.3.5, T08): тип, сложность, язык; «Выбор варианта» — 2–8 вариантов, ровно один правильный
 * (зелёная рамка); «Верно/Неверно» — два фиксированных варианта; «Вписать ответ» — «Правильный ответ».
 * Ошибки (AC-TCH-07) проверяются до запроса той же схемой QuestionDto, что и на сервере.
 */
export function QuestionForm({
  topicId,
  question,
  onDone,
  onCancel,
}: {
  topicId: string;
  question?: QuestionItem;
  onDone: (message: string) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations('teacher.quiz');
  const tf = useTranslations('forms');
  const errorText = useErrorText();
  const locale = useLocale();
  const [lang, setLang] = useState<Locale>(locale as Locale);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const initial = question ? valuesOf(question) : emptyQuestion();
  const form = useForm<QuestionValues>({ defaultValues: initial });
  // Индекс правильного варианта — отдельное состояние: радиокнопки не являются полями формы.
  const [correctIndex, setCorrectIndex] = useState<number | null>(initial.correct);
  const options = useFieldArray({ control: form.control, name: 'options' });
  const values = useWatch({ control: form.control }) as QuestionValues;
  const { errors } = form.formState;
  const prefix = question ? `q-${question.id}` : 'q-new';

  const filled = Object.fromEntries(
    LOCALES.map((l) => [
      l,
      Boolean(
        values.translations?.[l]?.text.trim() ||
        values.translations?.[l]?.explanation.trim() ||
        values.options?.some((o) => o.translations?.[l]?.trim()),
      ),
    ]),
  );

  // Ошибка списка вариантов (min2, max8, exactlyOneCorrect) — отдельно: у массива полей RHF хранит её в root.
  const [optionsError, setOptionsError] = useState<string | undefined>();

  function applyErrors(fieldErrors: Record<string, string>) {
    let first: Locale | null = null;
    for (const [path, message] of Object.entries(fieldErrors)) {
      if (path === 'options') {
        setOptionsError(message);
        continue;
      }
      form.setError(path as 'type', { message });
      const m = /^translations\.(ru|kk|en)\./.exec(path);
      if (m && !first) first = m[1] as Locale;
    }
    if (first) setLang(first);
  }

  const submit = form.handleSubmit(async (v) => {
    setFailed(false);
    form.clearErrors();
    setOptionsError(undefined);
    const body = toDto({ ...v, correct: correctIndex });
    const parsed = QuestionDto.safeParse(body);
    if (!parsed.success) {
      applyErrors(issuesByPath(parsed.error.issues));
      return;
    }
    setPending(true);
    const res = await apiRequest(
      question ? `/api/teacher/questions/${question.id}` : `/api/teacher/topics/${topicId}/quiz/questions`,
      { method: question ? 'PUT' : 'POST', body: parsed.data, locale },
    );
    setPending(false);
    if (res.kind === 'ok') {
      if (!question) {
        form.reset(emptyQuestion());
        setCorrectIndex(null);
      }
      onDone(question ? t('updated') : t('created'));
    } else if (res.kind === 'http' && res.error.fieldErrors) applyErrors(res.error.fieldErrors);
    else setFailed(true);
  });

  const correctRow = (i: number, label: React.ReactNode, key: string) => {
    const correct = correctIndex === i;
    return (
      <div
        key={key}
        data-testid="question-option"
        data-correct={correct}
        className={cn(
          'flex items-center gap-3 rounded-[var(--radius-field)] border p-2',
          correct
            ? 'border-[color-mix(in_srgb,var(--success)_60%,transparent)] bg-[color-mix(in_srgb,var(--success)_6%,transparent)]'
            : 'border-transparent',
        )}
      >
        <input
          type="radio"
          name={`${prefix}-correct`}
          checked={correct}
          onChange={() => setCorrectIndex(i)}
          aria-label={`${t('correct')}: ${t('option', { number: i + 1 })}`}
          className="size-5 shrink-0 accent-[var(--accent)]"
        />
        {label}
      </div>
    );
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5" data-testid="question-form">
      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-[var(--text-muted)]" id={`${prefix}-type`}>
          {t('type')}
        </span>
        <SegmentedControl
          label={t('type')}
          value={values.type}
          onValueChange={(v) => {
            form.setValue('type', v as QuestionType, { shouldDirty: true });
            setCorrectIndex(null);
          }}
          options={(['single_choice', 'true_false', 'text_input'] as const).map((v) => ({
            value: v,
            label: t(`types.${v}`),
          }))}
          className="flex-wrap"
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-[var(--text-muted)]">{t('difficulty')}</span>
        <SegmentedControl
          label={t('difficulty')}
          value={values.difficulty}
          onValueChange={(v) => form.setValue('difficulty', v as Difficulty, { shouldDirty: true })}
          options={(['easy', 'medium', 'hard'] as const).map((v) => ({
            value: v,
            label: t(`difficulties.${v}`),
          }))}
        />
      </div>
      <div>
        <LanguageTabs value={lang} onChange={setLang} filled={filled} label={t('language')} />
      </div>

      <div key={lang} className="flex flex-col gap-5">
        <Field
          id={`${prefix}-text-${lang}`}
          label={t('text')}
          error={errorText(errors.translations?.[lang]?.text?.message)}
        >
          <Textarea {...form.register(`translations.${lang}.text`)} lang={lang} maxLength={1000} />
        </Field>

        {values.type === 'single_choice' ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[13px] text-[var(--text-muted)]">{t('options')}</legend>
            {options.fields.map((f, i) =>
              correctRow(
                i,
                <>
                  <input
                    {...form.register(`options.${i}.translations.${lang}`)}
                    lang={lang}
                    maxLength={300}
                    aria-label={t('option', { number: i + 1 })}
                    aria-invalid={errors.options?.[i]?.translations ? true : undefined}
                    className={cn(fieldClass, 'min-w-0 flex-1')}
                  />
                  <button
                    type="button"
                    aria-label={t('removeOption', { number: i + 1 })}
                    onClick={() => {
                      options.remove(i);
                      setCorrectIndex((c) => (c === null || c === i ? null : c > i ? c - 1 : c));
                    }}
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--field)] hover:text-[var(--text)]"
                  >
                    <X aria-hidden="true" className="size-4" />
                  </button>
                </>,
                f.id,
              ),
            )}
            {options.fields.length < MAX_OPTIONS ? (
              <div>
                <Button
                  variant="text"
                  className="px-0"
                  onClick={() => options.append({ translations: emptyTexts() })}
                >
                  {t('addOption')}
                </Button>
              </div>
            ) : null}
          </fieldset>
        ) : null}

        {values.type === 'true_false' ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[13px] text-[var(--text-muted)]">{t('options')}</legend>
            {correctRow(0, <span className="py-2">{t('optionTrue')}</span>, 'true')}
            {correctRow(1, <span className="py-2">{t('optionFalse')}</span>, 'false')}
          </fieldset>
        ) : null}

        {optionsError || Object.keys(errors.options ?? {}).some((k) => /^\d+$/.test(k)) ? (
          <p role="alert" className="text-xs text-[var(--danger-text)]" data-testid="options-error">
            {errorText(optionsError ?? 'required')}
          </p>
        ) : null}

        {values.type === 'text_input' ? (
          <Field
            id={`${prefix}-answer`}
            label={t('textAnswer')}
            error={errorText(errors.textAnswer?.message)}
          >
            <Input {...form.register('textAnswer')} maxLength={300} />
          </Field>
        ) : null}

        <Field
          id={`${prefix}-explanation-${lang}`}
          label={t('explanation')}
          error={errorText(errors.translations?.[lang]?.explanation?.message)}
        >
          <Textarea {...form.register(`translations.${lang}.explanation`)} lang={lang} maxLength={2000} />
        </Field>
      </div>

      <p
        className={
          errors.translations?.message
            ? 'text-xs text-[var(--danger-text)]'
            : 'text-xs text-[var(--text-muted)]'
        }
        role={errors.translations?.message ? 'alert' : undefined}
      >
        {t('hint')}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} data-testid="question-submit">
          {question ? t('save') : t('create')}
        </Button>
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel}>
            {t('cancel')}
          </Button>
        ) : null}
        {failed ? (
          <span role="alert" className="text-sm text-[var(--danger-text)]">
            {tf('serverError')}
          </span>
        ) : null}
      </div>
    </form>
  );
}
