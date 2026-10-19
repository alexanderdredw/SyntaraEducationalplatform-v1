'use client';

import { useTranslations } from 'next-intl';
import { SchoolRequestDto } from '@syntara/shared';
import { Button, Field, Input, Textarea } from '@syntara/ui';
import { AppLink } from '../app-link';
import { ErrorSummary, SubmitError, SuccessNotice, useErrorText } from './form-parts';
import { useSubmitForm } from './use-submit-form';

const FIELDS = ['schoolName', 'region', 'city', 'contactPerson', 'phone', 'email', 'message'] as const;
type FieldName = (typeof FIELDS)[number];
const REQUIRED = new Set<FieldName>(['schoolName', 'contactPerson', 'email']);
const DEFAULTS = {
  schoolName: '',
  region: '',
  city: '',
  contactPerson: '',
  phone: '',
  email: '',
  message: '',
};
const fieldId = (name: FieldName) => `school-request-${name}`;

/** Форма заявки школы (REQ-PUB-REQ-01..02): поля и порядок — SchoolRequestDto, отправка — SM-FORM (API-PUB-04). */
export function SchoolRequestForm() {
  const t = useTranslations('schoolRequest');
  const tf = useTranslations('forms');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const { form, status, success, showSummary, summaryRef, onSubmit, blurValidate } = useSubmitForm({
    id: 'school-request',
    schema: SchoolRequestDto,
    defaults: DEFAULTS,
    endpoint: '/api/public/school-requests',
    fieldOrder: FIELDS,
  });
  const { errors } = form.formState;
  const labels = Object.fromEntries(FIELDS.map((f) => [f, t(`fields.${f}`)]));
  const ids = Object.fromEntries(FIELDS.map((f) => [f, fieldId(f)]));

  const field = (name: FieldName, multiline = false) => {
    const registration = form.register(name, { onBlur: () => blurValidate(name) });
    const control = multiline ? (
      <Textarea {...registration} placeholder={t(`placeholders.${name}`)} />
    ) : (
      <Input
        {...registration}
        placeholder={t(`placeholders.${name}`)}
        type={name === 'email' ? 'email' : name === 'phone' ? 'tel' : 'text'}
        autoComplete={name === 'email' ? 'email' : name === 'phone' ? 'tel' : undefined}
      />
    );
    return (
      <Field
        id={fieldId(name)}
        label={labels[name]!}
        required={REQUIRED.has(name)}
        error={errorText(errors[name]?.message)}
      >
        {control}
      </Field>
    );
  };

  return (
    <form noValidate onSubmit={onSubmit} data-testid="school-request-form" className="flex flex-col gap-5">
      {success && status === 'success' ? <SuccessNotice title={t('success')} success={success} /> : null}
      {showSummary ? (
        <ErrorSummary ref={summaryRef} errors={errors} order={FIELDS} labels={labels} ids={ids} />
      ) : null}

      {field('schoolName')}
      <div className="grid gap-5 md:grid-cols-2">
        {field('region')}
        {field('city')}
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        {field('contactPerson')}
        {field('phone')}
      </div>
      {field('email')}
      {field('message', true)}

      <p className="text-xs text-[var(--text-muted)]">{tf('consent')}</p>
      <SubmitError status={status} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AppLink
          href="/"
          className="inline-flex min-h-11 items-center rounded-[var(--radius-pill)] px-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          {tc('backHome')}
        </AppLink>
        <Button
          type="submit"
          variant="primary-blue"
          disabled={status === 'submitting'}
          aria-busy={status === 'submitting'}
        >
          {status === 'submitting' ? tf('submitting') : t('submit')}
        </Button>
      </div>
    </form>
  );
}
