'use client';

import './atlas.css';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import { AppLink } from '../../app-link';
import { AtlasSubjectProvider } from './atlas-data';
import { spaceGrotesk } from './fonts';
import { ATLAS_SCREENS, type AtlasScreen, atlasHref, parseAtlasPath } from './routes';

/** Раздел «таблетки» по адресу страницы (окна — в своём разделе). */
function useScreen(subjectId: string): AtlasScreen {
  const pathname = usePathname();
  const prefix = `/learn/subjects/${subjectId}`;
  const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : '';
  return parseAtlasPath(rest.split('/').filter(Boolean))?.screen ?? 'home';
}

/**
 * Оболочка «Mendeleev Atlas» (REQ-ATL-02): под шапкой платформы — полоса атласа с логотипом и «таблеткой» из 7
 * разделов, как в оригинале; кнопки темы и языка атласа нет — их функции у шапки платформы (решение 1). Тема —
 * data-theme платформы (стили атласа, atlas.css). Телефон: «☰ Меню» и логотип; меню — как в оригинале, плюс Esc и
 * возврат фокуса. Левая панель платформы остаётся (в ней активен «Каталог»).
 */
export function AtlasShell({
  subjectId,
  timeZone,
  children,
}: {
  subjectId: string;
  timeZone: string;
  children: ReactNode;
}) {
  const t = useTranslations('atlas.nav');
  const screen = useScreen(subjectId);
  const [open, setOpen] = useState(false);
  const burger = useRef<HTMLButtonElement>(null);
  const nav = useRef<HTMLElement>(null);

  // Меню закрывается выбором раздела (смена адреса), нажатием вне меню и Esc (как в оригинале + клавиатура).
  const [shown, setShown] = useState(screen);
  if (shown !== screen) {
    setShown(screen);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!nav.current?.contains(target) && !burger.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      burger.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Решение А-12: пока открыто меню атласа, плавающие кнопки платформы («?», чат) скрыты (atlas.css).
    document.documentElement.dataset.atlasMenu = 'open';
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      delete document.documentElement.dataset.atlasMenu;
    };
  }, [open]);

  return (
    <AtlasSubjectProvider subjectId={subjectId} timeZone={timeZone}>
      <div className={`atlas ${spaceGrotesk.variable}${open ? ' menu-open' : ''}`} data-testid="atlas">
        <header className="main-header" data-testid="atlas-bar">
          <button
            ref={burger}
            type="button"
            className={`burger-menu${open ? ' active' : ''}`}
            aria-label={t('list')}
            aria-expanded={open}
            aria-controls="atlas-nav"
            onClick={() => setOpen((v) => !v)}
            data-testid="atlas-burger"
          >
            <div className="burger-icon" aria-hidden="true">
              <div className="burger-line" />
              <div className="burger-line" />
              <div className="burger-line" />
            </div>
            <span className="burger-label">{t('list')}</span>
          </button>
          <AppLink href={atlasHref(subjectId, 'home')} className="logo" aria-label="Mendeleev Atlas">
            <span className="logo-icon" aria-hidden="true">
              ⚛
            </span>
            MENDELEEV<span className="text-highlight">ATLAS</span>
          </AppLink>
          <nav
            ref={nav}
            id="atlas-nav"
            className={`main-nav${open ? ' active' : ''}`}
            aria-label="Mendeleev Atlas"
            data-testid="atlas-nav"
          >
            {ATLAS_SCREENS.map((s) => (
              <AppLink
                key={s}
                href={atlasHref(subjectId, s)}
                className={`nav-btn${s === screen ? ' active' : ''}`}
                aria-current={s === screen ? 'page' : undefined}
                data-screen={s}
              >
                {t(s)}
              </AppLink>
            ))}
          </nav>
          {/* Место кнопки темы оригинала: «таблетка» остаётся по центру, как на эталоне. */}
          <div className="header-actions" aria-hidden="true">
            <span className="atlas-actions-spacer" />
          </div>
        </header>
        <div id="main-content">{children}</div>
      </div>
    </AtlasSubjectProvider>
  );
}
