'use client';

import { useCallback } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Controller } from 'react-hook-form';
import { type Locale, SupportCategory, SupportTicketDto } from '@syntara/shared';
import { Button, Card, Field, Input, Select, Textarea } from '@syntara/ui';
import { AppLink } from '../app-link';
import { usePreferences } from '../preferences/preferences-provider';
import { ErrorSummary, SubmitError, SuccessNotice, useErrorText } from './form-parts';
import { useSubmitForm } from './use-submit-form';

const FIELDS = ['category', 'subject', 'name', 'email', 'phone', 'description'] as const;
type FieldName = (typeof FIELDS)[number];
const REQUIRED = new Set<FieldName>(['category', 'subject', 'email', 'description']);
const fieldId = (name: FieldName) => `support-${name}`;
// Схема формы — без techContext: его форма добавляет сама при отправке (REQ-PUB-SUP-03).
const FormSchema = SupportTicketDto.omit({ techContext: true });

/**
 * Форма обращения (REQ-PUB-SUP-01..03, API-PUB-05). Категория по умолчанию — «Техническая проблема»;
 * `?category=` предвыбирает категорию. techContext (маршрут, версия, язык, режим трафика, user-agent)
 * добавляется автоматически; паролей, токенов и учебных работ в нём нет.
 */
export function SupportForm({ initialCategory }: { initialCategory?: SupportCategory }) {
  const t = useTranslations('support');
  const tf = useTranslations('forms');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const locale = useLocale() as Locale;
  const { dataSaver } = usePreferences();

  const extend = useCallback(
    () => ({
      techContext: {
        route: window.location.pathname,
        appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0',
        locale,
        dataSaver,
        userAgent: navigator.userAgent.slice(0, 300),
      },
    }),
    [locale, dataSaver],
  );

  const { form, status, success, showSummary, summaryRef, onSubmit, blurValidate } = useSubmitForm({
    id: 'support',
    schema: FormSchema,
    defaults: {
      category: initialCategory ?? 'technical',
      subject: '',
      name: '',
      email: '',
      phone: '',
      description: '',
    },
    endpoint: '/api/public/support-tickets',
    fieldOrder: FIELDS,
    extend,
  });
  const { errors } = form.formState;
  const labels = Object.fromEntries(FIELDS.map((f) => [f, t(`fields.${f}`)]));
  const ids = Object.fromEntries(FIELDS.map((f) => [f, fieldId(f)]));

  const text = (name: Exclude<FieldName, 'category'>, multiline = false) => {
    const registration = form.register(name, { onBlur: () => blurValidate(name) });
    return (
      <Field
        id={fieldId(name)}
        label={labels[name]!}
        required={REQUIRED.has(name)}
        error={errorText(errors[name]?.message)}
      >
        {multiline ? (
          <Textarea {...registration} />
        ) : (
          <Input
            {...registration}
            type={name === 'email' ? 'email' : name === 'phone' ? 'tel' : 'text'}
            autoComplete={
              name === 'email' ? 'email' : name === 'phone' ? 'tel' : name === 'name' ? 'name' : undefined
            }
          />
        )}
      </Field>
    );
  };

  return (
    <>
      <Card className="p-5 md:p-8">
        <form noValidate onSubmit={onSubmit} data-testid="support-form" className="flex flex-col gap-5">
          {success && status === 'success' ? <SuccessNotice title={t('success')} success={success} /> : null}
          {showSummary ? (
            <ErrorSummary ref={summaryRef} errors={errors} order={FIELDS} labels={labels} ids={ids} />
          ) : null}

          <div className="grid gap-5 md:grid-cols-2">
            <Controller
              control={form.control}
              name="category"
              render={({ field }) => (
                <Field
                  id={fieldId('category')}
                  label={labels.category!}
                  required
                  error={errorText(errors.category?.message)}
                >
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    options={SupportCategory.options.map((c) => ({ value: c, label: t(`categories.${c}`) }))}
                  />
                </Field>
              )}
            />
            {text('subject')}
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {text('name')}
            {text('email')}
          </div>
          {text('phone')}
          {text('description', true)}

          <p className="text-xs text-[var(--text-muted)]" data-testid="support-tech-note">
            {t('techContextNote')}
          </p>
          <SubmitError status={status} />
          <div>
            <Button type="submit" disabled={status === 'submitting'} aria-busy={status === 'submitting'}>
              {status === 'submitting' ? tf('submitting') : t('submit')}
            </Button>
          </div>
        </form>
      </Card>
      <div className="mt-6">
        <AppLink
          href="/"
          className="inline-flex min-h-11 items-center rounded-[var(--radius-pill)] px-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          {tc('backHome')}
        </AppLink>
      </div>
    </>
  );
}
