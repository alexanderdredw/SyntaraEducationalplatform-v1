'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { RadioGroup } from 'radix-ui';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Button, Card, cn } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { AppLink } from '../app-link';

type DemoQuestion = components['schemas']['DemoQuestionDto'];
type DemoAnswer = components['schemas']['DemoAnswerResponse'];

async function loadQuestion(locale: string, exclude: string | null): Promise<DemoQuestion> {
  const result = await apiRequest<DemoQuestion>(
    `/api/public/demo-question${exclude ? `?exclude=${exclude}` : ''}`,
    { locale },
  );
  if (result.kind !== 'ok') throw new Error('demo question failed');
  return result.data;
}

/**
 * Пробный вопрос (REQ-PUB-HOME-04, SM-DEMO): loading → question → answered; правильный ответ приходит
 * только после проверки (BR-QZ-01), баллы не начисляются (BR-QZ-09). Результат — текстом и иконкой, не только цветом.
 */
export function DemoQuestionBlock() {
  const t = useTranslations('home.demo');
  const locale = useLocale();
  const [exclude, setExclude] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | undefined>();
  const [answer, setAnswer] = useState<DemoAnswer | null>(null);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);

  const query = useQuery({
    queryKey: ['demo-question', locale, exclude],
    queryFn: () => loadQuestion(locale, exclude),
    retry: false,
    staleTime: Infinity,
  });

  const reset = () => {
    setSelected(undefined);
    setAnswer(null);
    setFailed(false);
  };

  if (query.isPending) {
    return (
      <Card data-testid="demo-question" aria-busy="true">
        <p role="status">{t('loading')}</p>
      </Card>
    );
  }

  if (query.isError || failed) {
    return (
      <Card data-testid="demo-question">
        <p role="alert">{t('loadError')}</p>
        <Button
          variant="secondary"
          className="mt-4"
          onClick={() => {
            reset();
            void query.refetch();
          }}
        >
          {t('retryLoad')}
        </Button>
      </Card>
    );
  }

  const question = query.data;
  const check = async () => {
    if (!selected) return;
    setChecking(true);
    const result = await apiRequest<DemoAnswer>('/api/public/demo-answer', {
      method: 'POST',
      locale,
      body: { questionId: question.id, version: question.version, optionId: selected },
    });
    setChecking(false);
    if (result.kind === 'ok') setAnswer(result.data);
    else setFailed(true);
  };

  return (
    <Card data-testid="demo-question" className="flex flex-col gap-5">
      <p id="demo-question-text" className="text-xl font-semibold">
        {question.text}
      </p>
      <RadioGroup.Root
        aria-labelledby="demo-question-text"
        aria-describedby="demo-options-hint"
        value={selected ?? ''}
        onValueChange={setSelected}
        disabled={answer !== null}
        className="flex flex-col gap-2"
      >
        <span id="demo-options-hint" className="sr-only">
          {t('optionsLabel')}
        </span>
        {question.options.map((option) => {
          const isCorrect = answer?.correctOptionId === option.id;
          const isChosen = selected === option.id;
          const isWrongChoice = answer !== null && isChosen && !isCorrect;
          return (
            <label
              key={option.id}
              data-testid="demo-option"
              data-state={isCorrect ? 'correct' : isWrongChoice ? 'wrong' : isChosen ? 'selected' : 'idle'}
              className={cn(
                'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-4 py-2',
                isCorrect
                  ? 'border-[var(--success)]'
                  : isWrongChoice
                    ? 'border-[var(--danger)]'
                    : isChosen
                      ? 'border-[var(--accent)]'
                      : 'border-[var(--border)]',
                answer !== null && 'cursor-default',
              )}
            >
              <RadioGroup.Item
                value={option.id}
                className="flex size-6 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--field)]"
              >
                <RadioGroup.Indicator className="size-3 rounded-full bg-[var(--accent)]" />
              </RadioGroup.Item>
              <span className="flex-1">{option.text}</span>
              {isCorrect ? (
                <span className="flex items-center gap-1 text-xs">
                  <CheckCircle2 aria-hidden="true" className="size-4 text-[var(--success)]" />
                  {t('correctOption')}
                </span>
              ) : null}
              {isWrongChoice ? (
                <span className="flex items-center gap-1 text-xs">
                  <XCircle aria-hidden="true" className="size-4 text-[var(--danger)]" />
                  {t('yourChoice')}
                </span>
              ) : null}
            </label>
          );
        })}
      </RadioGroup.Root>

      {answer === null ? (
        <div>
          <Button onClick={check} disabled={!selected || checking} aria-busy={checking}>
            {t('check')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div role="status" data-testid="demo-result" className="flex items-start gap-3">
            {answer.correct ? (
              <CheckCircle2 aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-[var(--success)]" />
            ) : (
              <XCircle aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-[var(--danger)]" />
            )}
            <div>
              <p className="text-lg font-semibold">{answer.correct ? t('correct') : t('incorrect')}</p>
              {answer.explanation ? (
                <p data-testid="demo-explanation" className="mt-1 text-[var(--text-muted)]">
                  {answer.explanation}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={reset}>
              {t('tryAgain')}
            </Button>
            {question.hasAnother ? (
              <Button
                variant="secondary"
                onClick={() => {
                  reset();
                  setExclude(question.id);
                }}
              >
                {t('another')}
              </Button>
            ) : null}
            <AppLink
              href="/subjects"
              className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--accent)] hover:underline"
            >
              {t('toSubject')}
            </AppLink>
          </div>
        </div>
      )}
    </Card>
  );
}
