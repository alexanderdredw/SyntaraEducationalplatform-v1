'use client';

import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
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
  phone,
  shortLabels = [],
  afterSections,
  extra,
  footer,
  resources,
  takeTest,
  assistant,
  overlay,
  onClose,
  testId,
  compact = false,
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
  /** Телефон (< 768 px): учёный — статья с закреплённым оглавлением, элемент — аккордеон; компьютер — вкладки. */
  phone?: 'article' | 'accordion';
  /** Короткие подписи оглавления статьи (Биография · Открытие · Наследие · Факты). */
  shortLabels?: string[];
  /** Сразу после разделов только на телефоне (цитата учёного — после статьи). */
  afterSections?: ReactNode;
  extra?: ReactNode;
  footer?: ReactNode;
  resources: Array<{ text: string; url: string }>;
  takeTest: ReactNode;
  assistant?: ReactNode;
  /** Панель ответа Syntara AI поверх окна (REQ-SCI-09.3). */
  overlay?: ReactNode;
  onClose: () => void;
  testId: string;
  /**
   * Окно элемента (docs/EXPLORE_TZ.md, REQ-EXP-04): компактная шапка (бейдж, название и «Пройти тест» в одну строку,
   * описание под ними) и закреплённая при прокрутке левая колонка на компьютере.
   */
  compact?: boolean;
}) {
  const t = useTranslations('atlas.detail');
  const tc = useTranslations('common');
  const root = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  useDialog(root, onClose);

  // REQ-EXP-04.2: левая колонка закреплена; если она выше окна — прокручивается до своего низа и закрепляется там
  // (отрицательный top), чтобы мини-таблица и навигация не оказались недоступны.
  useEffect(() => {
    const scroller = root.current;
    const node = column.current;
    if (!compact || !scroller || !node || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      node.style.top = `${Math.min(0, scroller.clientHeight - node.offsetHeight - 24)}px`;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [compact]);

  // Окно — position: fixed внутри .atlas (без своего контекста наложения), z-index выше шапки платформы.
  return (
    <div
      ref={root}
      className={`detail-overlay fade-in${compact ? ' detail-compact' : ''}`}
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
        {compact ? (
          <div className="detail-header">
            <div className="detail-head-row">
              {badge}
              <h2 className="detail-title" id="atlas-detail-title">
                {title}
              </h2>
              {takeTest}
            </div>
            <p className="detail-subtitle">{subtitle}</p>
          </div>
        ) : (
          <div className="detail-header">
            {badge}
            <h2 className="detail-title" id="atlas-detail-title">
              {title}
            </h2>
            <p className="detail-subtitle">{subtitle}</p>
            {takeTest}
          </div>
        )}
        <div className="detail-body">
          <div ref={column} className="detail-visual">
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
              <div className={phone ? 'atlas-desktop-only' : undefined}>
                <Tabs
                  tabs={tabs}
                  label={tabsLabel}
                  active={activeTab}
                  onActive={onTabChange}
                  equal={tabsEqual}
                />
              </div>
            ) : null}
            {tabs.length && phone ? (
              <div className="atlas-phone-only">
                {phone === 'article' ? (
                  <Article tabs={tabs} label={tabsLabel} short={shortLabels} onActive={onTabChange} />
                ) : (
                  <Accordion tabs={tabs} active={activeTab} onActive={onTabChange} />
                )}
                {afterSections}
              </div>
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

/** Без плавности в «Экономии трафика» и при prefers-reduced-motion (REQ-SCI-05 для телефона). */
function scrollBehavior(): ScrollBehavior {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return reduce || document.documentElement.dataset.dataSaver === 'true' ? 'auto' : 'smooth';
}

/**
 * Окно учёного на телефоне (< 768 px, уточнение REQ-SCI-05): все разделы подряд, как статья (заголовки h3); сверху —
 * закреплённое оглавление из коротких пунктов равной ширины (список ссылок, aria-current). Текущий раздел
 * подсвечивается при прокрутке окна, нажатие переносит к разделу.
 */
function Article({
  tabs,
  label,
  short,
  onActive,
}: {
  tabs: DetailTab[];
  label: string;
  short: string[];
  onActive: (index: number) => void;
}) {
  const prefix = useId();
  const [current, setCurrent] = useState(0);
  const sections = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    const first = sections.current[0];
    const scroller = first?.closest('.detail-overlay');
    if (!first || !scroller || typeof IntersectionObserver === 'undefined') return;
    // Текущий — последний раздел, верх которого прошёл под оглавлением.
    const update = () => {
      // Статья скрыта (компьютер — вкладки): прокрутка окна активный раздел не меняет.
      if (first.offsetParent === null) return;
      const top = scroller.getBoundingClientRect().top + 80;
      let index = 0;
      sections.current.forEach((s, i) => {
        if (s && s.getBoundingClientRect().top <= top) index = i;
      });
      setCurrent(index);
      onActive(index);
    };
    scroller.addEventListener('scroll', update, { passive: true });
    return () => scroller.removeEventListener('scroll', update);
  }, [onActive]);

  return (
    <div className="atlas-article" data-testid="atlas-article">
      <nav className="atlas-toc" aria-label={label} data-testid="atlas-toc">
        <ul style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map((tab, i) => (
            <li key={tab.id}>
              <a
                href={`#${prefix}-sec-${i}`}
                aria-current={i === current ? 'true' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  sections.current[i]?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
                  setCurrent(i);
                  onActive(i);
                }}
                data-testid="atlas-toc-link"
              >
                {short[i] ?? tab.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {tabs.map((tab, i) => (
        <section
          key={tab.id}
          id={`${prefix}-sec-${i}`}
          ref={(node) => {
            sections.current[i] = node;
          }}
          className="atlas-article-section detail-description"
          aria-labelledby={`${prefix}-h-${i}`}
          data-testid="atlas-article-section"
        >
          <h3 id={`${prefix}-h-${i}`}>{tab.label}</h3>
          {tab.content}
        </section>
      ))}
    </div>
  );
}

/**
 * Окно элемента на телефоне (уточнение REQ-SCI-06): разделы урока — аккордеон; видны все заголовки, открыт один
 * (первый — по умолчанию); при открытии окно подстраивается к началу раздела; в конце — «Следующий: {название} →».
 */
function Accordion({
  tabs,
  active,
  onActive,
}: {
  tabs: DetailTab[];
  active: number;
  onActive: (index: number) => void;
}) {
  const t = useTranslations('atlas.detail');
  const prefix = useId();
  const heads = useRef<Array<HTMLButtonElement | null>>([]);
  const open = (i: number) => {
    onActive(i);
    // После раскрытия — к началу раздела.
    window.requestAnimationFrame(() =>
      heads.current[i]?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }),
    );
  };
  return (
    <div className="atlas-accordion" data-testid="atlas-accordion">
      {tabs.map((tab, i) => {
        const expanded = i === active;
        const next = tabs[i + 1];
        return (
          <div key={tab.id} className="atlas-acc-item" data-open={expanded || undefined}>
            <h3 className="atlas-acc-heading">
              <button
                ref={(node) => {
                  heads.current[i] = node;
                }}
                type="button"
                className="atlas-acc-head"
                aria-expanded={expanded}
                aria-controls={`${prefix}-acc-${i}`}
                id={`${prefix}-acc-h-${i}`}
                onClick={() => open(i)}
                data-testid="atlas-acc-head"
              >
                <span>{tab.label}</span>
                <span aria-hidden="true" className="atlas-acc-icon">
                  {expanded ? '−' : '+'}
                </span>
              </button>
            </h3>
            <div
              id={`${prefix}-acc-${i}`}
              role="region"
              aria-labelledby={`${prefix}-acc-h-${i}`}
              hidden={!expanded}
              className="atlas-acc-panel detail-description"
              data-testid="atlas-acc-panel"
            >
              {tab.content}
              {next ? (
                <button
                  type="button"
                  className="atlas-acc-next"
                  onClick={() => open(i + 1)}
                  data-testid="atlas-acc-next"
                >
                  {t('nextSection', { title: next.label })}
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
