'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AI_QUICK_ACTIONS } from '@syntara/shared';
import { Button, Modal } from '@syntara/ui';
import { TutorChatLoader } from './tutor-chat-loader';

const INPUT_ID = 'assistant-input';

/**
 * /learn/assistant (8.4.5, REQ-ST-AI-03, U02): «Syntara AI», «Ваш личный помощник в учёбе», «Начать обучение с ИИ»
 * (фокус в поле), «Как это работает» (модальное окно, PH-21) и общий диалог (context = general_tutor).
 * Абзац под заголовком на эталоне U02 («Syntara анализирует ваш прогресс…») не выводится, пока такой функции нет
 * (решение владельца 2026-10-17, журнал SPEC 16).
 */
export function AssistantPage() {
  const t = useTranslations('student.assistant');
  const ta = useTranslations('student.ai');
  const tc = useTranslations('common');
  const [howOpen, setHowOpen] = useState(false);

  const start = () => {
    const input = document.getElementById(INPUT_ID);
    input?.scrollIntoView({ block: 'center' });
    input?.focus();
  };

  return (
    <section className="mx-auto flex max-w-[1000px] flex-col gap-6 px-4 py-8" data-testid="assistant-page">
      <header className="flex flex-col gap-3">
        <h1 className="text-page-title font-bold">{t('title')}</h1>
        <p className="text-cabinet-title font-bold text-[var(--text-muted)]">{t('subtitle')}</p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={start} data-testid="assistant-start">
            {t('start')}
          </Button>
          <Modal
            open={howOpen}
            onOpenChange={setHowOpen}
            title={t('how')}
            closeLabel={tc('close')}
            trigger={
              <Button variant="secondary" data-testid="assistant-how">
                {t('how')}
              </Button>
            }
          >
            {/* PH-21: уровень объяснения и быстрые действия учебного ИИ. */}
            <div className="mt-4 flex flex-col gap-3 text-sm" data-testid="assistant-how-content">
              <p>{ta('level')}</p>
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {AI_QUICK_ACTIONS.map((action) => (
                  <li key={action}>{ta(`quickText.${action}`)}</li>
                ))}
              </ul>
              <p className="text-[var(--text-muted)]">{ta('disclaimer')}</p>
            </div>
          </Modal>
        </div>
      </header>
      <TutorChatLoader context="general_tutor" inputId={INPUT_ID} />
    </section>
  );
}
