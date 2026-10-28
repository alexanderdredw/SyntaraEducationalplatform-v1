'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, FileText } from 'lucide-react';
import { Button, Input, Modal } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { formatDateTime } from '@/lib/datetime';
import { AppLink } from '../app-link';
import { useErrorText } from '../forms/form-parts';
import { TeacherQuiz } from '../learn/quiz';
import { type Lesson, LessonView } from '../lesson/lesson-view';
import { firstFieldError, StatusPill } from './parts';

type Topic = components['schemas']['TopicDetailDto'];
type PublishResult = components['schemas']['PublishResultDto'];
type Version = components['schemas']['TopicVersionDto'];

/**
 * Публикация темы (8.3.4, T07, SM-TOPIC): статус-капсула (REQ-TCH-PUB-01), «Посмотреть глазами ученика»
 * (API-T-15), «Опубликовать» (API-T-12, светлая кнопка), «История версий» (API-T-14, без восстановления — PH-25),
 * «Снять с публикации» (API-T-13, PH-27), «Что изменилось» ≤ 500 (REQ-TCH-PUB-03), «Редактировать квиз»
 * (REQ-TCH-PUB-04). Несохранённые правки перед действием сохраняются (`beforeAction`) — ученик видит
 * только опубликованный снимок (REQ-TCH-PUB-05).
 */
export function PublishPanel({
  topic,
  title,
  timeZone,
  beforeAction,
}: {
  topic: Topic;
  title: string;
  timeZone: string;
  beforeAction: () => Promise<boolean>;
}) {
  const t = useTranslations('teacher.topic');
  const tc = useTranslations('common');
  const tl = useTranslations('student.lesson');
  const tf = useTranslations('forms');
  const errorText = useErrorText();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [preview, setPreview] = useState<Lesson | null>(null);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const published = topic.status === 'published';

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    setMessage(null);
    setBusy(true);
    try {
      if (!(await beforeAction())) return undefined;
      return await action();
    } finally {
      setBusy(false);
    }
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['teacher'] });

  const publish = () =>
    run(async () => {
      const res = await apiRequest<PublishResult>(`/api/teacher/topics/${topic.id}/publish`, {
        method: 'POST',
        body: note.trim() ? { changeNote: note } : {},
        locale,
      });
      if (res.kind === 'ok') {
        setNote('');
        setMessage({ text: t('publishedDone', { version: res.data.versionNo ?? '' }) });
        await refresh();
      } else {
        const key = res.kind === 'http' ? firstFieldError(res.error.fieldErrors) : undefined;
        setMessage({ text: key ? errorText(key)! : tf('serverError'), error: true });
      }
    });

  const unpublish = () =>
    run(async () => {
      const res = await apiRequest(`/api/teacher/topics/${topic.id}/unpublish`, { method: 'POST', locale });
      setMessage(
        res.kind === 'ok' ? { text: t('unpublishedDone') } : { text: tf('serverError'), error: true },
      );
      await refresh();
    });

  const showPreview = () =>
    run(async () => {
      const res = await apiRequest<Lesson>(`/api/teacher/topics/${topic.id}/preview`, { locale });
      if (res.kind === 'ok') setPreview(res.data);
      else setMessage({ text: tf('serverError'), error: true });
    });

  async function showVersions() {
    setMessage(null);
    const res = await apiRequest<Version[]>(`/api/teacher/topics/${topic.id}/versions`, { locale });
    if (res.kind === 'ok') setVersions(res.data);
    else setMessage({ text: tf('serverError'), error: true });
  }

  return (
    <section aria-labelledby="publication-title" className="flex flex-col gap-3" data-testid="publish-panel">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="publication-title" className="text-[15px] font-medium">
          {t('publication')}
        </h2>
        <StatusPill tone={published ? 'success' : 'neutral'}>
          <span data-testid="topic-status">{published ? t('statusPublished') : t('statusDraft')}</span>
        </StatusPill>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => void showPreview()}>
          {t('preview')}
        </Button>
        <Button variant="publish" disabled={busy} onClick={() => void publish()} data-testid="publish">
          {t('publish')}
        </Button>
        <Button variant="quiet" disabled={busy} onClick={() => void showVersions()}>
          {t('history')}
        </Button>
        {published ? (
          <Button variant="text" disabled={busy} onClick={() => void unpublish()} data-testid="unpublish">
            {t('unpublish')}
          </Button>
        ) : null}
      </div>
      <label htmlFor="change-note" className="sr-only">
        {t('changeNote')}
      </label>
      <Input
        id="change-note"
        value={note}
        maxLength={500}
        placeholder={t('changeNote')}
        onChange={(e) => setNote(e.target.value)}
      />
      <p
        role="status"
        className={message?.error ? 'text-sm text-[var(--danger-text)]' : 'text-sm'}
        data-testid="publish-status"
      >
        {message?.text}
      </p>
      <div>
        <Button asChild variant="secondary" shape="rounded">
          <AppLink href={`/teacher/topics/${topic.id}/quiz`} className="text-[var(--text-muted)]">
            <FileText aria-hidden="true" className="size-4" />
            {t('editQuiz')}
            <ArrowRight aria-hidden="true" className="size-4" />
          </AppLink>
        </Button>
      </div>

      <Modal
        open={preview !== null}
        onOpenChange={(open) => !open && setPreview(null)}
        title={t('previewTitle', { title: preview?.title || title })}
        wide
        closeLabel={tc('close')}
      >
        <div
          role="region"
          aria-label={t('previewTitle', { title: preview?.title || title })}
          // Прокрутка окна — с клавиатуры (axe scrollable-region-focusable): урок и тест длиннее экрана телефона.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          className="max-h-[70vh] overflow-y-auto pr-1"
        >
          {preview ? <LessonView lesson={preview} /> : null}
          {/* Тест темы — как у ученика, в режиме предпросмотра (решение владельца 2026-10-28). */}
          {preview ? (
            <section className="mt-6 border-t border-[var(--border)] pt-6" aria-labelledby="preview-quiz">
              <h3 id="preview-quiz" className="mb-3 text-lg font-bold">
                {tl('quiz')}
              </h3>
              <TeacherQuiz topicId={topic.id} />
            </section>
          ) : null}
        </div>
      </Modal>
      <Modal
        open={versions !== null}
        onOpenChange={(open) => !open && setVersions(null)}
        title={t('history')}
        closeLabel={tc('close')}
      >
        {versions?.length ? (
          <ol className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto" data-testid="versions">
            {versions.map((v) => (
              <li key={v.id} className="rounded-[var(--radius-field)] border border-[var(--border)] p-3">
                <p className="font-semibold">{t('version', { version: v.versionNo })}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {t('versionMeta', { date: formatDateTime(v.createdAt, timeZone), author: v.authorName })}
                </p>
                {v.changeNote ? <p className="mt-1 text-sm">{v.changeNote}</p> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">{t('noVersions')}</p>
        )}
      </Modal>
    </section>
  );
}
