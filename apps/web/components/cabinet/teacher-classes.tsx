'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, EmptyState, Field, Input, Modal } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { formatDateTime } from '@/lib/datetime';
import { useErrorText } from '../forms/form-parts';
import { AppLink } from '../app-link';
import { ClassRoster } from './class-roster';

type TeacherClass = components['schemas']['TeacherClassDto'];
type IssuedCode = components['schemas']['IssuedCodeDto'];

const KEY = ['teacher', 'classes'];

/**
 * Классы учителя (итерация 6, минимальная страница /teacher/classes): список с числом учеников (API-T-04),
 * создание (API-T-05), выпуск кода (API-T-06, BR-CLS-01) — код показывается один раз.
 */
export function TeacherClasses({ timeZone }: { timeZone: string }) {
  const t = useTranslations('teacher.classes');
  const ta = useTranslations('teacher.analytics');
  const tc = useTranslations('common');
  const tf = useTranslations('forms');
  const errorText = useErrorText();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState(false);
  const [issued, setIssued] = useState<{ cls: TeacherClass; code: IssuedCode } | null>(null);
  const [copied, setCopied] = useState(false);
  const [openRoster, setOpenRoster] = useState<string | null>(null);

  const classes = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const res = await apiRequest<TeacherClass[]>('/api/teacher/classes', { locale });
      if (res.kind !== 'ok') throw new Error('classes');
      return res.data;
    },
  });

  const create = async () => {
    setFailed(false);
    if (!name.trim()) return setNameError('required');
    if (name.trim().length > 50) return setNameError('tooLong');
    setNameError(undefined);
    setCreating(true);
    const res = await apiRequest<TeacherClass>('/api/teacher/classes', {
      method: 'POST',
      body: { name },
      locale,
    });
    setCreating(false);
    if (res.kind === 'ok') {
      setName('');
      await queryClient.invalidateQueries({ queryKey: KEY });
    } else if (res.kind === 'http' && res.error?.fieldErrors?.name) {
      setNameError(res.error.fieldErrors.name);
    } else setFailed(true);
  };

  const issue = async (cls: TeacherClass) => {
    setFailed(false);
    setCopied(false);
    const res = await apiRequest<IssuedCode>(`/api/teacher/classes/${cls.id}/invite-codes`, {
      method: 'POST',
      locale,
    });
    if (res.kind === 'ok') setIssued({ cls, code: res.data });
    else setFailed(true);
  };

  return (
    <section className="mx-auto flex max-w-[960px] flex-col gap-6 px-4 py-8" data-testid="teacher-classes">
      <h1 className="text-cabinet-title font-bold">{t('title')}</h1>

      <Card>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <div className="flex-1">
            <Field id="class-name" label={t('name')} required error={errorText(nameError)}>
              <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" disabled={creating} className="sm:min-h-[var(--field-h)]">
            {t('create')}
          </Button>
        </form>
      </Card>

      {failed ? (
        <p role="alert" className="text-sm text-[var(--danger-text)]">
          {tf('serverError')}
        </p>
      ) : null}

      {classes.data && classes.data.length === 0 ? <EmptyState title={t('empty')} /> : null}
      <ul className="flex flex-col gap-3">
        {classes.data?.map((cls) => (
          <li key={cls.id}>
            <Card
              className="flex flex-wrap items-center justify-between gap-3 p-4"
              data-testid="teacher-class"
            >
              <div>
                <p className="font-semibold">{cls.name}</p>
                <p className="text-sm text-[var(--text-muted)]">
                  {t('students', { count: cls.studentsCount })}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="text"
                  aria-expanded={openRoster === cls.id}
                  onClick={() => setOpenRoster(openRoster === cls.id ? null : cls.id)}
                >
                  {t('showStudents')}
                </Button>
                <Button variant="secondary" onClick={() => void issue(cls)}>
                  {t('issueCode')}
                </Button>
                {/* REQ-TCH-AN-01: страницы класса — «Ростер», «Карта освоения», «Аналитика класса». */}
                <Button variant="secondary" asChild>
                  <AppLink href={`/teacher/classes/${cls.id}/analytics`} data-testid="class-analytics-link">
                    {ta('open')}
                  </AppLink>
                </Button>
              </div>
              {openRoster === cls.id ? (
                <div className="w-full">
                  <ClassRoster classId={cls.id} />
                </div>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>

      <Modal
        open={issued !== null}
        onOpenChange={(open) => !open && setIssued(null)}
        title={issued ? t('codeTitle', { name: issued.cls.name }) : ''}
        closeLabel={tc('close')}
      >
        {issued ? (
          <div className="flex flex-col gap-4">
            <p data-testid="issued-code" className="font-mono text-4xl font-bold tracking-[0.3em]">
              {issued.code.code}
            </p>
            <p className="text-sm text-[var(--text-muted)]">
              {t('codeOnce', { date: formatDateTime(issued.code.expiresAt, timeZone) })}
            </p>
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                onClick={async () => {
                  await navigator.clipboard?.writeText(issued.code.code).catch(() => undefined);
                  setCopied(true);
                }}
              >
                {t('copy')}
              </Button>
              <span role="status" className="text-sm">
                {copied ? t('copied') : ''}
              </span>
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
