import { type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { cn } from './cn';

/**
 * Каркасы оболочки (3.2/3.3). Наполнение (меню, язык, тема, трафик, профиль) — итерации 3 и 6;
 * здесь только разметка и доступность. Все тексты приходят пропсами из i18n.
 */

/**
 * Header: «плавающая» панель, закреплённая сверху (REQ-GEN-SHELL-01/-02, UX-01; эталоны U01–T10):
 * отступ от краёв окна, скругление, фон --chrome, тонкая рамка.
 */
export function Header({ children, className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <header className={cn('sticky top-0 z-30 px-2 pt-2.5 sm:px-4', className)} {...props}>
      <HeaderBar>{children}</HeaderBar>
    </header>
  );
}

/** Панель-капсула хедера; повторяется вверху открытого мобильного меню (UX-10), чтобы панель не «прыгала». */
export function HeaderBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex min-h-[60px] flex-wrap items-center gap-2 rounded-[18px] border border-[var(--chrome-border)] bg-[var(--chrome)] px-3 py-1.5 shadow-chrome',
        className,
      )}
    >
      {children}
    </div>
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
 * баннер публикует свою высоту в CSS-переменной --cookie-banner-h. На телефоне (< 768 px) — в ряд; `hidden` —
 * кнопки убраны с экрана (поле ввода в фокусе или под ними поля и текст), но фокус с клавиатуры их возвращает.
 */
export function FloatingHelp({
  children,
  hidden = false,
  ref,
}: {
  children: ReactNode;
  hidden?: boolean;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={ref}
      data-testid="floating-help"
      data-hidden={hidden ? 'true' : 'false'}
      className={cn(
        'fixed right-4 z-30 flex items-center gap-2 transition-opacity duration-150 motion-reduce:transition-none md:flex-col md:gap-3',
        hidden && 'pointer-events-none opacity-0 focus-within:pointer-events-auto focus-within:opacity-100',
      )}
      style={{ bottom: 'calc(var(--cookie-banner-h, 0px) + 16px)' }}
    >
      {children}
    </div>
  );
}

/**
 * Знак Syntara в плитке (эталоны U01–T10, UX-01). TODO(OWNER): файл знака (SVG) не предоставлен —
 * пока плитка с буквой «S» в фирменном цвете. Декоративный: смысл передаёт слово рядом или aria-label ссылки.
 */
export function BrandMark({ size = 'md', className }: { size?: 'md' | 'sm' | 'lg'; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center border border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[linear-gradient(160deg,#2f7df0,#1240a8)] font-bold leading-none text-white',
        size === 'md' && 'size-[34px] rounded-[10px] text-base',
        size === 'sm' && 'size-7 rounded-[8px] text-sm',
        size === 'lg' && 'size-11 rounded-[12px] text-xl',
        className,
      )}
    >
      S
    </span>
  );
}

/** Слово «Syntara»: окончание «ara» — фирменным синим (эталоны хедера). */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-bold tracking-tight', className)}>
      Synt<span className="text-[var(--accent-bright)]">ara</span>
    </span>
  );
}

/** Капсула-группа хедера (UX-01, эталоны U01–T10): общая рамка и фон для нескольких элементов управления. */
export function Capsule({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-[var(--radius-pill)] border border-[var(--capsule-border)] bg-[var(--capsule)] p-0.5',
        className,
      )}
    >
      {children}
    </div>
  );
}
