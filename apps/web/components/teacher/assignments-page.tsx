'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, EmptyState, Field, Input, Select, Skeleton } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { formatDateTime, tzOffset } from '@/lib/datetime';
import { useErrorText } from '../forms/form-parts';

type TeacherClass = components['schemas']['TeacherClassDto'];
type Options = components['schemas']['AssignmentOptionsDto'];
type Assignment = components['schemas']['TeacherAssignmentDto'];
type ReviewItem = components['schemas']['ReviewItemDto'];

const LIST = ['teacher', 'assignments'];
type Errors = Partial<Record<'classId' | 'subjectId' | 'topicId' | 'dueAt', string>>;

/**
 * /teacher/assignments (8.3.6, T09): «Выдать задание» (REQ-TCH-ASG-01, BR-ASG-01/02 — темы по выбранному предмету,
 * смена предмета сбрасывает тему; срок — дата и время в PLATFORM_TZ, PH-31), «Выданные задания» со счётчиками
 * (REQ-TCH-ASG-02, BR-ASG-03) и «Проверка» (REQ-TCH-ASG-03, PH-29 — пусто).
 */
export function TeacherAssignmentsPage({ timeZone }: { timeZone: string }) {
  const t = useTranslations('teacher.assignments');
  const tf = useTranslations('forms');
  const errorText = useErrorText();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [due, setDue] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'done' | 'failed' | null>(null);

  const get = async <T,>(path: string) => {
    const res = await apiRequest<T>(path, { locale });
    if (res.kind !== 'ok') throw new Error(path);
    return res.data;
  };
  const classes = useQuery({
    queryKey: ['teacher', 'classes'],
    queryFn: () => get<TeacherClass[]>('/api/teacher/classes'),
  });
  const options = useQuery({
    queryKey: ['teacher', 'assignment-options', classId, locale],
    queryFn: () => get<Options>(`/api/teacher/classes/${classId}/assignment-options`),
    enabled: Boolean(classId),
  });
  const list = useQuery({
    queryKey: [...LIST, locale],
    queryFn: () => get<Assignment[]>('/api/teacher/assignments'),
  });
  const review = useQuery({
    queryKey: ['teacher', 'review-queue'],
    queryFn: () => get<ReviewItem[]>('/api/teacher/review-queue'),
  });

  const subjects = options.data?.subjects ?? [];
  const topics = subjects.find((s) => s.id === subjectId)?.topics ?? [];

  const submit = async () => {
    setStatus(null);
    const next: Errors = {};
    if (!classId) next.classId = 'required';
    if (!subjectId) next.subjectId = 'required';
    if (!topicId) next.topicId = 'required';
    if (!due) next.dueAt = 'invalidDate';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    // Срок вводится в часовом поясе платформы (PH-42) и уходит как ISO 8601 со смещением.
    const dueAt = `${due}:00${tzOffset(new Date(`${due}:00Z`), timeZone)}`;
    const res = await apiRequest<{ id: string }>('/api/teacher/assignments', {
      method: 'POST',
      body: { classId, subjectId, topicId, dueAt },
      locale,
    });
    setBusy(false);
    if (res.kind === 'ok') {
      setStatus('done');
      setTopicId('');
      setDue('');
      await queryClient.invalidateQueries({ queryKey: LIST });
    } else if (res.kind === 'http' && res.error.fieldErrors) {
      setErrors(res.error.fieldErrors as Errors);
    } else {
      setStatus('failed');
    }
  };

  const noClasses = classes.data?.length === 0;
  return (
    <section
      className="mx-auto flex max-w-[792px] flex-col gap-8 px-4 py-8"
      data-testid="teacher-assignments"
    >
      <h1 className="text-cabinet-title font-bold">{t('title')}</h1>

      <Card className="flex flex-col gap-4" data-testid="assignment-form">
        <div className="flex flex-col gap-2">
          <h2 className="text-base font-bold">{t('issueTitle')}</h2>
          <p className="text-sm text-[var(--text-muted)]">{t('issueText')}</p>
        </div>
        {noClasses ? (
          <p className="text-sm text-[var(--text-muted)]">{t('noClasses')}</p>
        ) : (
          <form
            noValidate
            className="grid gap-4 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Field label={t('class')} error={errorText(errors.classId)} required>
              <Select
                placeholder={t('choose')}
                value={classId || undefined}
                options={(classes.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
                onValueChange={(value) => {
                  setClassId(value);
                  setSubjectId('');
                  setTopicId('');
                }}
              />
            </Field>
            <Field label={t('subject')} error={errorText(errors.subjectId)} required>
              <Select
                placeholder={t('choose')}
                value={subjectId || undefined}
                options={subjects.map((s) => ({ value: s.id, label: s.title }))}
                onValueChange={(value) => {
                  // BR-ASG-02: при смене предмета выбранная тема сбрасывается.
                  setSubjectId(value);
                  setTopicId('');
                }}
              />
            </Field>
            <Field label={t('topic')} error={errorText(errors.topicId)} required>
              <Select
                placeholder={t('choose')}
                value={topicId || undefined}
                options={topics.map((tp) => ({ value: tp.id, label: tp.title }))}
                onValueChange={setTopicId}
              />
            </Field>
            <Field label={t('due')} error={errorText(errors.dueAt)} required>
              <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
            </Field>
            {classId && options.data && subjects.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] md:col-span-2">{t('noTopics')}</p>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-3 md:col-span-2">
              {status === 'done' ? (
                <p role="status" className="text-sm text-[var(--success-text)]">
                  {t('done')}
                </p>
              ) : null}
              {status === 'failed' ? (
                <p role="alert" className="text-sm text-[var(--danger-text)]">
                  {tf('serverError')}
                </p>
              ) : null}
              <Button type="submit" disabled={busy} data-testid="assignment-submit">
                {t('issue')}
              </Button>
            </div>
          </form>
        )}
      </Card>

      <section className="flex flex-col gap-3" aria-labelledby="assignments-issued">
        <h2 id="assignments-issued" className="text-base font-bold">
          {t('issued')}
        </h2>
        {list.isPending ? <Skeleton className="h-20" /> : null}
        {list.data?.length === 0 ? (
          <Card>
            <EmptyState title={t('empty')} />
          </Card>
        ) : null}
        <ul className="flex flex-col gap-3">
          {list.data?.map((a) => (
            <li key={a.id}>
              <Card
                className="flex flex-wrap items-center justify-between gap-3"
                data-testid="assignment-card"
              >
                <div className="flex flex-col gap-1">
                  <p>{a.topicTitle}</p>
                  <p className="text-sm text-[var(--text-muted)]">
                    {t('classDue', { className: a.className, due: formatDateTime(a.dueAt, timeZone) })}
                  </p>
                </div>
                <p className="text-xs text-[var(--text-muted)]" data-testid="assignment-counts">
                  {t('counts', a.counts)}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="assignments-review">
        <h2 id="assignments-review" className="text-base font-bold">
          {t('review')}
        </h2>
        <Card data-testid="review-queue">
          {review.data && review.data.length > 0 ? null : <EmptyState title={t('reviewEmpty')} />}
        </Card>
      </section>
    </section>
  );
}
