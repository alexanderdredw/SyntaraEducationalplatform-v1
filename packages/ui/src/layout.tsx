import { type ReactNode } from 'react';
import { cn } from './cn';

/**
 * Каркасы оболочки (3.2/3.3). Наполнение (меню, язык, тема, трафик, профиль) — итерации 3 и 6;
 * здесь только разметка и доступность. Все тексты приходят пропсами из i18n.
 */

/** Header: закреплён сверху (REQ-GEN-SHELL-01). */
export function Header({ logo, nav, actions }: { logo: ReactNode; nav?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-[1600px] items-center gap-6 px-4">
        <div className="shrink-0">{logo}</div>
        {nav ? <div className="hidden flex-1 lg:block">{nav}</div> : <div className="flex-1" />}
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** Footer: синий градиент (REQ-GEN-SHELL-05). */
export function Footer({ children, bottom }: { children: ReactNode; bottom?: ReactNode }) {
  return (
    <footer className="bg-[linear-gradient(180deg,#1765e8,#0b3a91)] text-white">
      <div className="mx-auto grid max-w-[1240px] gap-8 px-4 py-12 md:grid-cols-4">{children}</div>
      {bottom ? <div className="border-t border-white/20 px-4 py-4 text-center text-sm">{bottom}</div> : null}
    </footer>
  );
}

export interface SidebarItem {
  href: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
}

/** Sidebar кабинетов ~70 px; активный — синяя подложка и полоса слева (REQ-GEN-SHELL-03). */
export function Sidebar({
  items,
  label,
  renderLink,
}: {
  items: SidebarItem[];
  label: string;
  renderLink?: (item: SidebarItem, children: ReactNode, className: string) => ReactNode;
}) {
  return (
    <nav
      aria-label={label}
      className="flex w-[var(--sidebar-w)] shrink-0 flex-col items-center gap-2 bg-[var(--sidebar)] py-4"
    >
      {items.map((item) => {
        const className = cn(
          'relative flex size-11 items-center justify-center rounded-[var(--radius-field)] text-[var(--accent)] hover:bg-[var(--field)]',
          item.active &&
            'bg-[var(--accent)]/20 before:absolute before:-left-3 before:h-6 before:w-1 before:rounded before:bg-[var(--accent)]',
        );
        const children = (
          <>
            <span aria-hidden="true">{item.icon}</span>
            <span className="sr-only">{item.label}</span>
          </>
        );
        return (
          <span key={item.href}>
            {renderLink ? (
              renderLink(item, children, className)
            ) : (
              <a href={item.href} className={className} aria-current={item.active ? 'page' : undefined}>
                {children}
              </a>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/**
 * FloatingHelp: плавающие кнопки справа внизу (REQ-GEN-SHELL-04). Поднимаются над cookie-баннером:
 * баннер публикует свою высоту в CSS-переменной --cookie-banner-h.
 */
export function FloatingHelp({ children }: { children: ReactNode }) {
  return (
    <div
      className="fixed right-4 z-30 flex flex-col items-center gap-3"
      style={{ bottom: 'calc(var(--cookie-banner-h, 0px) + 16px)' }}
    >
      {children}
    </div>
  );
}
