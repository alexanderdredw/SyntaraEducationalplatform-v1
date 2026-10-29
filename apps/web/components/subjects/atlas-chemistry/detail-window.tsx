'use client';

import { type KeyboardEvent, type ReactNode, useId, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useDialog } from './dialog';

/** Вкладка окна: подпись и содержимое (показывается полностью, без «Подробнее»). */
export interface DetailTab {
  id: string;
  label: string;
  content: ReactNode;
}

/**
 * Окно элемента или учёного (AnatomyViewer.js, openAnatomyDetail): на весь экран поверх шапки платформы (решение
 * А-8) — бейдж, крупное название, описание, большая картинка, вкладки-разделы (docs/SCIENTISTS_TZ.md, REQ-SCI-05,
 * REQ-SCI-06: вместо «Обзора» с «Подробнее» и некликабельных «Слоёв»), «Внешние ресурсы», блок «Syntara AI
 * Ассистент» заменён карточкой «AI-помощник» (REQ-SCI-09 ред. 2) в `extra`. `aside` — блоки рядом с картинкой (цитата, ключевые факты), `extra` — после вкладок, `footer` — перед
 * помощником. Кнопка «Пройти тест» — под описанием (решение А-3). Доступность — role dialog, фокус внутри, Esc = «×».
 */
export function DetailWindow({
  title,
  subtitle,
  badge,
  visual,
  aside,
  tabs,
  tabsLabel,
  activeTab,
  onTabChange,
  tabsEqual = false,
  extra,
  footer,
  resources,
  takeTest,
  assistant,
  overlay,
  onClose,
  testId,
}: {
  title: string;
  subtitle: string;
  badge: ReactNode;
  visual: ReactNode;
  aside?: ReactNode;
  tabs: DetailTab[];
  tabsLabel: string;
  activeTab: number;
  onTabChange: (index: number) => void;
  /** Вкладки равной ширины без прокрутки (учёный после нормализации — REQ-SCI-09.5). */
  tabsEqual?: boolean;
  extra?: ReactNode;
  footer?: ReactNode;
  resources: Array<{ text: string; url: string }>;
  takeTest: ReactNode;
  assistant?: ReactNode;
  /** Панель ответа Syntara AI поверх окна (REQ-SCI-09.3). */
  overlay?: ReactNode;
  onClose: () => void;
  testId: string;
}) {
  const t = useTranslations('atlas.detail');
  const tc = useTranslations('common');
  const root = useRef<HTMLDivElement>(null);
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
              {aside}
            </div>
          </div>
          <div className="detail-info">
            {tabs.length ? (
              <Tabs
                tabs={tabs}
                label={tabsLabel}
                active={activeTab}
                onActive={onTabChange}
                equal={tabsEqual}
              />
            ) : null}
            {extra}
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
        {footer}
      </div>
      {assistant ? <div id="ai-assistant-container">{assistant}</div> : null}
      {overlay}
    </div>
  );
}

/**
 * Вкладки-разделы окна (REQ-SCI-05.2, REQ-SCI-06.2): роль tablist, стрелки влево/вправо, Home и End; полоса вкладок
 * прокручивается по горизонтали, активная — в зоне видимости. Содержимое — полностью.
 */
function Tabs({
  tabs,
  label,
  active,
  onActive,
  equal,
}: {
  tabs: DetailTab[];
  label: string;
  active: number;
  onActive: (index: number) => void;
  equal: boolean;
}) {
  const prefix = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const current = Math.min(active, tabs.length - 1);
  const go = (i: number) => {
    onActive(i);
    const button = buttons.current[i];
    button?.focus();
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const onKey = (e: KeyboardEvent) => {
    const last = tabs.length - 1;
    const next =
      e.key === 'ArrowRight'
        ? current === last
          ? 0
          : current + 1
        : e.key === 'ArrowLeft'
          ? current === 0
            ? last
            : current - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    // Стрелки во вкладках не уходят дальше (навигация окна их не перехватывает, REQ-SCI-11.1).
    e.preventDefault();
    e.stopPropagation();
    go(next);
  };
  return (
    <div className={`atlas-tabs${equal ? ' equal' : ''}`} data-testid="atlas-tabs">
      <div className="atlas-tablist" role="tablist" aria-label={label}>
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            ref={(node) => {
              buttons.current[i] = node;
            }}
            type="button"
            role="tab"
            id={`${prefix}-tab-${i}`}
            aria-selected={i === current}
            aria-controls={`${prefix}-panel-${i}`}
            tabIndex={i === current ? 0 : -1}
            className={`atlas-tab${i === current ? ' active' : ''}`}
            onClick={() => go(i)}
            onKeyDown={onKey}
            data-testid="atlas-tab"
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${prefix}-panel-${i}`}
          aria-labelledby={`${prefix}-tab-${i}`}
          hidden={i !== current}
          tabIndex={0}
          className="atlas-tabpanel detail-description"
          data-testid="atlas-tabpanel"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
