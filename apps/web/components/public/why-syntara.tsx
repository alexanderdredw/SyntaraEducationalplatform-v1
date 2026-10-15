'use client';

import { useRef, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { cn } from '@syntara/ui';
import { usePreservedState } from '../preferences/preserved-state';

const ITEMS = ['languages', 'tutor', 'devices', 'access', 'progress'] as const;

/**
 * «Почему Syntara?» (REQ-PUB-HOME-07, AC-PUB-02): одно состояние activeIndex для пунктов, панели и индикаторов;
 * без автопрокрутки; клавиатура — шаблон tablist (←/→, Home/End). Состояние переживает смену языка.
 */
export function WhySyntara() {
  const t = useTranslations('home.why');
  const [active, setActive] = usePreservedState('home.why.activeIndex', 0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (index: number, focus = false) => {
    const next = (index + ITEMS.length) % ITEMS.length;
    setActive(next);
    if (focus) tabs.current[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const keys: Record<string, number> = {
      ArrowRight: active + 1,
      ArrowDown: active + 1,
      ArrowLeft: active - 1,
      ArrowUp: active - 1,
      Home: 0,
      End: ITEMS.length - 1,
    };
    const target = keys[event.key];
    if (target === undefined) return;
    event.preventDefault();
    select(target, true);
  };

  const key = ITEMS[active] ?? ITEMS[0];
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div
        role="tablist"
        aria-label={t('listLabel')}
        aria-orientation="vertical"
        className="flex flex-col gap-2"
      >
        {ITEMS.map((item, index) => (
          <button
            key={item}
            ref={(el) => {
              tabs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`why-tab-${item}`}
            aria-selected={index === active}
            aria-controls="why-panel"
            tabIndex={index === active ? 0 : -1}
            onClick={() => select(index)}
            onKeyDown={onKeyDown}
            className={cn(
              'min-h-11 rounded-[var(--radius-field)] px-4 py-3 text-left text-base font-semibold',
              index === active ? 'bg-white text-[#0b3a91]' : 'text-white/85 hover:bg-white/10',
            )}
          >
            {t(`items.${item}`)}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="why-panel"
        aria-labelledby={`why-tab-${key}`}
        data-testid="why-panel"
        className="flex flex-col justify-between gap-6 rounded-[var(--radius-card)] bg-white/10 p-6"
      >
        <p className="text-2xl font-semibold text-white">{t(`panels.${key}`)}</p>
        <div className="flex items-center justify-between">
          <div className="flex gap-2" aria-hidden="true" data-testid="why-indicators">
            {ITEMS.map((item, index) => (
              <span
                key={item}
                data-active={index === active}
                className={cn(
                  'h-2 rounded-full transition-all duration-200 ease-[var(--ease-standard)]',
                  index === active ? 'w-8 bg-white' : 'w-2 bg-white/40',
                )}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => select(active + 1)}
            aria-label={t('next')}
            aria-controls="why-panel"
            className="inline-flex size-12 items-center justify-center rounded-full bg-white text-[#0b3a91]"
          >
            <ArrowRight aria-hidden="true" className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
