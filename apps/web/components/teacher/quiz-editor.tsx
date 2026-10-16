'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus } from 'lucide-react';
import { Button, Card, EmptyState, Modal, Skeleton } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { CABINET_FORM_WIDTH, PageHeader, StatusPill } from './parts';
import { QuestionForm } from './question-form';

type Quiz = components['schemas']['QuizDto'];
type QuestionItem = components['schemas']['QuestionItemDto'];

/** Текст на языке интерфейса, иначе ru, en, kk. */
function pick<T>(translations: Partial<Record<string, T>>, locale: string): T | undefined {
  for (const l of [locale, 'ru', 'en', 'kk']) if (translations[l]) return translations[l];
  return undefined;
}

/**
 * Квиз темы (/teacher/topics/:id/quiz, 8.3.5, T08): «+ Добавить вопрос» (API-T-20) и список вопросов с порядком,
 * редактированием и архивированием (API-T-19, API-T-21, REQ-TCH-QZ-04).
 */
export function QuizEditor({ topicId }: { topicId: string }) {
  const t = useTranslations('teacher.quiz');
  const tc = useTranslations('common');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<QuestionItem | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const key = ['teacher', 'quiz', topicId];

  const quiz = useQuery({
    queryKey: key,
    queryFn: async () => {
      const res = await apiRequest<Quiz>(`/api/teacher/topics/${topicId}/quiz`, { locale });
      if (res.kind !== 'ok') throw new Error('quiz');
      return res.data;
    },
  });

  const done = async (message: string) => {
    setEditing(null);
    setStatus(message);
    await queryClient.invalidateQueries({ queryKey: key });
  };

  async function archive() {
    if (!archiving) return;
    const res = await apiRequest(`/api/teacher/questions/${archiving.id}`, { method: 'DELETE', locale });
    setArchiving(null);
    if (res.kind === 'ok') await done(t('archived'));
  }

  return (
    <section
      className={`mx-auto flex ${CABINET_FORM_WIDTH} flex-col gap-8 px-4 py-8`}
      data-testid="quiz-editor"
    >
      <PageHeader title={t('title')} back={{ href: `/teacher/topics/${topicId}`, label: t('back') }} />
      <Card className="flex flex-col gap-5 p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-cabinet-block font-semibold">
          <Plus aria-hidden="true" className="size-5 text-[var(--accent)]" />
          {t('addQuestion').replace(/^\+\s*/, '')}
        </h2>
        <QuestionForm topicId={topicId} onDone={(m) => void done(m)} />
      </Card>
      <p role="status" className="text-sm" data-testid="quiz-status">
        {status}
      </p>

      <section aria-labelledby="questions-title" className="flex flex-col gap-3">
        <h2 id="questions-title" className="text-cabinet-block font-semibold">
          {t('list')}
        </h2>
        {quiz.isPending ? <Skeleton className="h-24" /> : null}
        {quiz.data?.questions.length === 0 ? <EmptyState title={t('empty')} /> : null}
        <ol className="flex flex-col gap-3">
          {quiz.data?.questions.map((q) => {
            const tr = pick(q.translations, locale);
            return (
              <li key={q.id}>
                <Card className="flex flex-col gap-3 p-5" data-testid="quiz-question">
                  {editing === q.id ? (
                    <QuestionForm
                      topicId={topicId}
                      question={q}
                      onDone={(m) => void done(m)}
                      onCancel={() => setEditing(null)}
                    />
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{t('editQuestion', { number: q.number })}</span>
                        <StatusPill tone="neutral">{t(`types.${q.type}`)}</StatusPill>
                        <StatusPill tone="neutral">{t(`difficulties.${q.difficulty}`)}</StatusPill>
                      </div>
                      <p>{tr?.text}</p>
                      {q.type === 'text_input' ? (
                        <p className="flex items-center gap-2 text-sm">
                          <Check aria-hidden="true" className="size-4 text-[var(--success)]" />
                          {t('textAnswer')}: {q.textAnswer}
                        </p>
                      ) : (
                        <ul className="flex flex-col gap-1 text-sm">
                          {q.options.map((o) => (
                            <li key={o.id} className="flex items-center gap-2">
                              {o.isCorrect ? (
                                <Check aria-label={t('correct')} className="size-4 text-[var(--success)]" />
                              ) : (
                                <span className="size-4" aria-hidden="true" />
                              )}
                              {pick(o.translations, locale)}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" onClick={() => setEditing(q.id)}>
                          {t('edit')}
                        </Button>
                        <Button variant="text" onClick={() => setArchiving(q)}>
                          {t('archive')}
                        </Button>
                      </div>
                    </>
                  )}
                </Card>
              </li>
            );
          })}
        </ol>
      </section>

      <Modal
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
        title={t('archive')}
        description={t('archiveConfirm')}
        closeLabel={tc('close')}
      >
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={() => setArchiving(null)}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void archive()} data-testid="archive-confirm">
            {t('archive')}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
