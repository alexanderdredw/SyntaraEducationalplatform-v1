'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useForm, useWatch } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { type Locale, LOCALES, SubjectDto } from '@syntara/shared';
import { Button, Card, Checkbox, Field, Input, Textarea } from '@syntara/ui';
import { useRouter } from '@/i18n/navigation';
import { apiRequest } from '@/lib/api/browser';
import { useErrorText } from '../forms/form-parts';
import { issuesByPath } from './parts';
import { LanguageTabs } from './parts';

type Lang = { title: string; description: string };
export interface SubjectValues {
  translations: Record<Locale, Lang>;
  inPublicCatalog: boolean;
}

export const emptySubject = (): SubjectValues => ({
  translations: {
    ru: { title: '', description: '' },
    kk: { title: '', description: '' },
    en: { title: '', description: '' },
  },
  inPublicCatalog: false,
});

/**
 * Форма предмета (8.3.1, T05; на T04 — правка): переводы RU/KK/EN в одной форме RHF — переключение вкладки и
 * смена языка интерфейса не теряют ввод (REQ-TCH-SUBJ-01, REQ-GEN-PREF-05). Машинного перевода нет.
 * Создание → API-T-02 и переход на страницу предмета (REQ-TCH-SUBJ-04); правка → API-T-03.
 */
export function SubjectForm({
  mode,
  subjectId,
  initial,
}: {
  mode: 'create' | 'edit';
  subjectId?: string;
  initial?: SubjectValues;
}) {
  const t = useTranslations('teacher.subjectForm');
  const tf = useTranslations('forms');
  const errorText = useErrorText();
  const uiLocale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [lang, setLang] = useState<Locale>(uiLocale as Locale);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<'saved' | 'failed' | null>(null);
  const form = useForm<SubjectValues>({ defaultValues: initial ?? emptySubject() });
  const { errors } = form.formState;
  const translations = useWatch({ control: form.control, name: 'translations' });
  const inCatalog = useWatch({ control: form.control, name: 'inPublicCatalog' });
  const filled = Object.fromEntries(
    LOCALES.map((l) => [
      l,
      Boolean(translations?.[l]?.title.trim() || translations?.[l]?.description.trim()),
    ]),
  );

  /** Ошибки Zod/сервера → поля; поле на другой вкладке — переключаемся на неё. */
  function applyErrors(fieldErrors: Record<string, string>) {
    let first: Locale | null = null;
    for (const [path, message] of Object.entries(fieldErrors)) {
      form.setError(path as 'translations', { message });
      const m = /^translations\.(ru|kk|en)\./.exec(path);
      if (m && !first) first = m[1] as Locale;
    }
    if (first) setLang(first);
  }

  const submit = form.handleSubmit(async (values) => {
    setStatus(null);
    form.clearErrors();
    const parsed = SubjectDto.safeParse(values);
    if (!parsed.success) {
      applyErrors(issuesByPath(parsed.error.issues));
      return;
    }
    setPending(true);
    const res = await apiRequest<{ id: string }>(
      mode === 'create' ? '/api/teacher/subjects' : `/api/teacher/subjects/${subjectId}`,
      { method: mode === 'create' ? 'POST' : 'PATCH', body: parsed.data, locale: uiLocale },
    );
    setPending(false);
    if (res.kind === 'ok') {
      await queryClient.invalidateQueries({ queryKey: ['teacher'] });
      if (mode === 'create') router.push(`/teacher/subjects/${res.data.id}`);
      else {
        form.reset(values);
        setStatus('saved');
      }
      return;
    }
    if (res.kind === 'http' && res.error.fieldErrors) applyErrors(res.error.fieldErrors);
    else setStatus('failed');
  });

  const translationsError = errors.translations?.message;
  return (
    <Card className="p-5 sm:p-6">
      <form noValidate onSubmit={submit} className="flex flex-col gap-5" data-testid="subject-form">
        <div>
          <LanguageTabs value={lang} onChange={setLang} filled={filled} label={t('language')} />
        </div>
        {/* Поля всех языков остаются в форме; показывается выбранный (REQ-GEN-PREF-05). */}
        <div key={lang} className="flex flex-col gap-5">
          <Field
            id={`subject-title-${lang}`}
            label={t('name')}
            error={errorText(errors.translations?.[lang]?.title?.message)}
          >
            <Input {...form.register(`translations.${lang}.title`)} lang={lang} maxLength={150} />
          </Field>
          <Field
            id={`subject-description-${lang}`}
            label={t('description')}
            error={errorText(errors.translations?.[lang]?.description?.message)}
          >
            <Textarea {...form.register(`translations.${lang}.description`)} lang={lang} maxLength={1000} />
          </Field>
        </div>
        <p
          id="subject-languages-hint"
          className={
            translationsError ? 'text-xs text-[var(--danger-text)]' : 'text-xs text-[var(--text-muted)]'
          }
          role={translationsError ? 'alert' : undefined}
        >
          {t('hint')}
        </p>
        <div className="rounded-[var(--radius-field)] border border-[var(--border)] bg-[var(--field)] p-4">
          <Checkbox
            label={t('catalog')}
            description={t('catalogHint')}
            checked={inCatalog}
            onCheckedChange={(v) => form.setValue('inPublicCatalog', v, { shouldDirty: true })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={pending} data-testid="subject-submit">
            {mode === 'create' ? t('create') : t('save')}
          </Button>
          <span role="status" className="text-sm">
            {status === 'saved' ? t('saved') : status === 'failed' ? tf('serverError') : null}
          </span>
        </div>
      </form>
    </Card>
  );
}
