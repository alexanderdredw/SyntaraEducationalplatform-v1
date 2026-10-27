'use client';

import { type ReactNode, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useDialog } from './dialog';

export type AssistantMode = 'simple' | 'details' | 'quiz';

/**
 * Окно элемента или учёного (AnatomyViewer.js, openAnatomyDetail): на весь экран поверх шапки платформы (решение
 * А-8) — бейдж, крупное название, описание, большая картинка, «Обзор» с «Подробнее», чипы слоёв, «Внешние
 * ресурсы», блок «Syntara AI Ассистент». Кнопка «Пройти тест» — под описанием (решение А-3). Доступность — role
 * dialog, фокус внутри, Esc = «×» (без изменения вида).
 */
export function DetailWindow({
  title,
  subtitle,
  badge,
  visual,
  overview,
  layers,
  resources,
  takeTest,
  assistant,
  onClose,
  testId,
}: {
  title: string;
  subtitle: string;
  badge: ReactNode;
  visual: ReactNode;
  overview: ReactNode;
  layers: string[];
  resources: Array<{ text: string; url: string }>;
  takeTest: ReactNode;
  assistant: ReactNode;
  onClose: () => void;
  testId: string;
}) {
  const t = useTranslations('atlas.detail');
  const tc = useTranslations('common');
  const root = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  useDialog(root, onClose);

  // Окно — position: fixed внутри .atlas (без своего контекста наложения), z-index выше шапки платформы.
  return (
    <div
      ref={root}
      className="detail-overlay fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="atlas-detail-title"
      translate="no"
      data-testid={testId}
    >
      <button type="button" className="close-btn" aria-label={tc('close')} onClick={onClose}>
        &times;
      </button>
      <div className="detail-content">
        <div className="detail-header">
          {badge}
          <h2 className="detail-title" id="atlas-detail-title">
            {title}
          </h2>
          <p className="detail-subtitle">{subtitle}</p>
          {takeTest}
        </div>
        <div className="detail-body">
          <div className="detail-visual">
            <div
              className="visual-stack"
              style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}
            >
              {visual}
            </div>
          </div>
          <div className="detail-info">
            <h3>{t('overview')}</h3>
            <div className={`detail-text-wrapper${expanded ? ' expanded' : ''}`} id="atlas-detail-text">
              <div className="detail-description">{overview}</div>
              <div className="detail-fade" />
            </div>
            <button
              type="button"
              className="read-more-btn"
              aria-expanded={expanded}
              aria-controls="atlas-detail-text"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <>{t('readLess')} &uarr;</> : <>{t('readMore')} &darr;</>}
            </button>
            <div className="layers-control">
              <h4>{t('layers')}</h4>
              {layers.map((l) => (
                <span key={l} className="tag">
                  {l}
                </span>
              ))}
            </div>
            {resources.length ? (
              <div className="resource-links">
                <h4>{t('resources')}</h4>
                <div className="resource-list">
                  {resources.map((r) => (
                    <a
                      key={r.url}
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="resource-link"
                    >
                      {r.text}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div id="ai-assistant-container">{assistant}</div>
    </div>
  );
}

/**
 * Блок «Syntara AI Ассистент» окна (LearningAssistant.js): «Кратко» и «Подробно» — в чат Syntara AI об элементе,
 * «Тест» — тест темы платформы; «Изучение» убран (решение А-3).
 */
export function AssistantBlock({
  mode,
  onMode,
  children,
  id,
}: {
  mode: AssistantMode | null;
  onMode: (mode: AssistantMode) => void;
  children: ReactNode;
  id?: string;
}) {
  const t = useTranslations('atlas.assistant');
  return (
    <div className="ai-assistant fade-in-up" id={id} data-testid="atlas-assistant">
      <div className="ai-header">
        <div className="ai-icon animated-logo" aria-hidden="true">
          <div className="neural-node" />
        </div>
        <div className="ai-title">{t('title')}</div>
      </div>
      <div className="ai-content" id="ai-content-area">
        {mode === 'quiz' ? children : <p className="ai-placeholder">{t('placeholder')}</p>}
      </div>
      <div className="ai-actions">
        {(['simple', 'details', 'quiz'] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={`ai-btn${mode === m ? ' active' : ''}`}
            aria-pressed={mode === m}
            onClick={() => onMode(m)}
            data-mode={m}
          >
            {t(m)}
          </button>
        ))}
      </div>
    </div>
  );
}
