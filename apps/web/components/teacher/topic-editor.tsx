'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { type Locale, LOCALES, TopicContentDto } from '@syntara/shared';
import { Button, Card, Field, Input, Skeleton, Textarea } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { useErrorText } from '../forms/form-parts';
import { issuesByPath } from './parts';
import { MarkdownField } from './markdown-field';
import { CABINET_FORM_WIDTH, LanguageTabs, PageHeader } from './parts';
import { pickTitle } from './subject-page';
import { CoverPicker } from './topic-cover';
import { MaterialsList, type Material } from './topic-materials';
import { PublishPanel } from './topic-publish';

type Topic = components['schemas']['TopicDetailDto'];
type AiDraft = components['schemas']['AiDraftResponse'];
type Lang = { title: string; description: string; funFact: string; bodyMd: string };
export interface TopicValues {
  translations: Record<Locale, Lang>;
  coverUrl: string;
  coverMediaId: string | null;
}

const emptyLang = (): Lang => ({ title: '', description: '', funFact: '', bodyMd: '' });

function valuesOf(topic: Topic): TopicValues {
  const translations = { ru: emptyLang(), kk: emptyLang(), en: emptyLang() };
  for (const l of LOCALES) {
    const tr = topic.translations[l];
    if (tr) {
      translations[l] = {
        title: tr.title ?? '',
        description: tr.description ?? '',
        funFact: tr.funFact ?? '',
        bodyMd: tr.bodyMd ?? '',
      };
    }
  }
  return { translations, coverUrl: topic.coverUrl ?? '', coverMediaId: topic.coverMediaId };
}

/**
 * Редактор темы (8.3.3, T06–T07) в порядке REQ-TCH-TOP-01: панель ИИ → RU/KK/EN → «Название» → «Описание» →
 * «Интересный факт» → «Текст урока» → «Обложка темы» → «Материалы урока» → «Сохранить» → публикация (8.3.4).
 * Все языки — в одной форме RHF (REQ-GEN-PREF-05). «Сохранить» (API-T-10) не меняет статус (REQ-TCH-TOP-06).
 */
export function TopicEditor({ id, timeZone }: { id: string; timeZone: string }) {
  const t = useTranslations('teacher.topic');
  const tsf = useTranslations('teacher.subjectForm');
  const tf = useTranslations('forms');
  const errorText = useErrorText();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [lang, setLang] = useState<Locale>(locale as Locale);
  const [materials, setMaterials] = useState<Material[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'failed' | null>(null);
  const [ai, setAi] = useState<'idle' | 'busy' | 'unavailable' | 'filled'>('idle');
  const [materialsError, setMaterialsError] = useState<string | undefined>();
  const initialized = useRef(false);
  const form = useForm<TopicValues>({
    defaultValues: {
      translations: { ru: emptyLang(), kk: emptyLang(), en: emptyLang() },
      coverUrl: '',
      coverMediaId: null,
    },
  });
  const { errors } = form.formState;
  const translations = useWatch({ control: form.control, name: 'translations' });
  const coverUrl = useWatch({ control: form.control, name: 'coverUrl' });

  const pendingFiles = (materials ?? []).some((m) => m.scanStatus === 'pending');
  const topic = useQuery({
    queryKey: ['teacher', 'topic', id],
    queryFn: async () => {
      const res = await apiRequest<Topic>(`/api/teacher/topics/${id}`, { locale });
      if (res.kind !== 'ok') throw new Error('topic');
      return res.data;
    },
    // Пока файл проверяется (SM-FILE), статус обновляется сам.
    refetchInterval: pendingFiles ? 4000 : false,
  });

  useEffect(() => {
    if (!topic.data) return;
    if (!initialized.current) {
      initialized.current = true;
      form.reset(valuesOf(topic.data));
      setMaterials(topic.data.materials);
      return;
    }
    // Обновляются только статусы проверки; порядок и состав списка — из формы.
    const fresh = new Map(topic.data.materials.map((m) => [m.id, m]));
    setMaterials((list) => list?.map((m) => fresh.get(m.id) ?? m) ?? null);
  }, [topic.data, form]);

  const filled = Object.fromEntries(
    LOCALES.map((l) => [l, Object.values(translations?.[l] ?? {}).some((v) => v.trim())]),
  );

  function applyErrors(fieldErrors: Record<string, string>) {
    let first: Locale | null = null;
    for (const [path, message] of Object.entries(fieldErrors)) {
      if (path === 'materialIds') {
        setMaterialsError(message);
        continue;
      }
      form.setError(path as 'translations', { message });
      const m = /^translations\.(ru|kk|en)\./.exec(path);
      if (m && !first) first = m[1] as Locale;
    }
    if (first) setLang(first);
  }

  /** API-T-10. Возвращает true, если сохранено. */
  async function save(): Promise<boolean> {
    setSaveStatus(null);
    setMaterialsError(undefined);
    form.clearErrors();
    const values = form.getValues();
    // PH-26: ссылка в поле — источник обложки (сервер скачает её, BR-FILE-06), иначе — выбранный файл.
    const coverUrl = values.coverUrl.trim();
    const parsed = TopicContentDto.safeParse({
      translations: values.translations,
      coverMediaId: coverUrl ? null : values.coverMediaId,
      coverUrl: coverUrl || null,
      materialIds: (materials ?? []).map((m) => m.id),
    });
    if (!parsed.success) {
      applyErrors(issuesByPath(parsed.error.issues));
      return false;
    }
    setSaving(true);
    const res = await apiRequest(`/api/teacher/topics/${id}`, { method: 'PUT', body: parsed.data, locale });
    setSaving(false);
    if (res.kind === 'ok') {
      // Обложка по ссылке скачана в галерею — отмечаем её выбранной.
      const fresh = await apiRequest<Topic>(`/api/teacher/topics/${id}`, { locale });
      form.reset({
        ...values,
        coverMediaId: fresh.kind === 'ok' ? fresh.data.coverMediaId : values.coverMediaId,
      });
      setSaveStatus('saved');
      await queryClient.invalidateQueries({ queryKey: ['teacher', 'topic', id] });
      await queryClient.invalidateQueries({ queryKey: ['teacher', 'gallery'] });
      return true;
    }
    if (res.kind === 'http' && res.error.fieldErrors) applyErrors(res.error.fieldErrors);
    else setSaveStatus('failed');
    return false;
  }

  /** API-T-11: заполняет описание, факт и текст RU и KK в форме; ничего не сохраняет (REQ-TCH-TOP-02). */
  async function generate() {
    setAi('busy');
    const title = pickTitle(form.getValues('translations'), locale);
    const res = await apiRequest<AiDraft>(`/api/teacher/topics/${id}/ai-draft`, {
      method: 'POST',
      body: title ? { title } : {},
      locale,
      timeoutMs: 60_000,
    });
    if (res.kind !== 'ok') return setAi('unavailable');
    for (const l of ['ru', 'kk'] as const) {
      // Название — тоже от ИИ, на языке черновика; учитель может его поправить.
      for (const field of ['title', 'description', 'funFact', 'bodyMd'] as const) {
        form.setValue(`translations.${l}.${field}`, res.data[l][field], { shouldDirty: true });
      }
    }
    setAi('filled');
  }

  if (!topic.data || materials === null) {
    return (
      <section className={`mx-auto ${CABINET_FORM_WIDTH} px-4 py-8`}>
        <Skeleton className="h-96" />
      </section>
    );
  }

  const savedTitle = pickTitle(topic.data.translations, locale);
  const tl = errors.translations?.[lang];
  return (
    <section
      className={`mx-auto flex ${CABINET_FORM_WIDTH} flex-col gap-8 px-4 py-8`}
      data-testid="topic-editor"
    >
      <PageHeader
        title={savedTitle || t('newTitle')}
        back={{ href: `/teacher/subjects/${topic.data.subjectId}`, label: t('back') }}
      />
      <Card className="p-5 sm:p-6">
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="flex flex-col gap-2 rounded-[var(--radius-field)] border border-dashed border-[#8b5cf6]/60 bg-[var(--field)] p-4">
            <div>
              <Button
                variant="ai"
                disabled={ai === 'busy'}
                onClick={() => void generate()}
                data-testid="ai-draft"
              >
                <Sparkles aria-hidden="true" className="size-4" />
                {t('aiButton')}
              </Button>
            </div>
            <p className="text-xs text-[var(--text-muted)]">{t('aiHint')}</p>
            <p role="status" className="text-sm" data-testid="ai-status">
              {ai === 'busy' ? t('aiGenerating') : ai === 'filled' ? t('aiFilled') : null}
              {ai === 'unavailable' ? (
                <span className="text-[var(--danger-text)]">{t('aiUnavailable')}</span>
              ) : null}
            </p>
          </div>

          <div>
            <LanguageTabs value={lang} onChange={setLang} filled={filled} label={tsf('language')} />
          </div>
          <div key={lang} className="flex flex-col gap-5">
            <Field id={`topic-title-${lang}`} label={t('name')} error={errorText(tl?.title?.message)}>
              <Input {...form.register(`translations.${lang}.title`)} lang={lang} maxLength={150} />
            </Field>
            <Field
              id={`topic-description-${lang}`}
              label={t('description')}
              error={errorText(tl?.description?.message)}
            >
              <Textarea {...form.register(`translations.${lang}.description`)} lang={lang} maxLength={1000} />
            </Field>
            <Field id={`topic-funFact-${lang}`} label={t('funFact')} error={errorText(tl?.funFact?.message)}>
              <Textarea {...form.register(`translations.${lang}.funFact`)} lang={lang} maxLength={500} />
            </Field>
            <Controller
              control={form.control}
              name={`translations.${lang}.bodyMd`}
              render={({ field }) => (
                <MarkdownField
                  id={`topic-body-${lang}`}
                  label={t('body')}
                  lang={lang}
                  maxLength={50000}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  aria-invalid={tl?.bodyMd ? true : undefined}
                />
              )}
            />
          </div>

          <Controller
            control={form.control}
            name="coverMediaId"
            render={({ field }) => (
              <CoverPicker
                coverMediaId={field.value}
                coverUrl={coverUrl}
                urlError={errorText(errors.coverUrl?.message ?? errors.coverMediaId?.message)}
                onSelect={(mediaId: string | null) => {
                  // PH-26: последнее действие побеждает — файл из галереи заменяет ссылку.
                  field.onChange(mediaId);
                  if (mediaId) form.setValue('coverUrl', '', { shouldDirty: true });
                }}
                onUrl={(url: string) => {
                  form.setValue('coverUrl', url, { shouldDirty: true });
                  if (url) field.onChange(null);
                }}
              />
            )}
          />

          <MaterialsList
            topicId={id}
            materials={materials}
            onChange={setMaterials}
            error={errorText(materialsError)}
          />

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
          <div className="flex flex-wrap items-center gap-4">
            <Button type="submit" disabled={saving} data-testid="topic-save">
              {t('save')}
            </Button>
            <span role="status" className="text-sm" data-testid="topic-save-status">
              {saveStatus === 'saved' ? t('saved') : saveStatus === 'failed' ? tf('serverError') : null}
              {saveStatus === null && form.formState.isDirty ? (
                <span className="text-[var(--text-muted)]">{t('unsaved')}</span>
              ) : null}
            </span>
          </div>
        </form>
      </Card>

      <PublishPanel
        topic={topic.data}
        title={savedTitle}
        timeZone={timeZone}
        beforeAction={async () =>
          form.formState.isDirty || materialsChanged(materials, topic.data) ? save() : true
        }
      />
    </section>
  );
}

/** Состав или порядок материалов отличается от сохранённого. */
function materialsChanged(local: Material[], topic: Topic): boolean {
  return local.map((m) => m.id).join() !== topic.materials.map((m) => m.id).join();
}
