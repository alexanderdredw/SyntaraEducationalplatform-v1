import { type ReactNode } from 'react';
import { cn } from '@syntara/ui';
import { AppLink } from '../app-link';

/** Секция публичной страницы: ширина контента 1120–1240 px (3.1), якоря учитывают высоту хедера. */
export function Section({
  id,
  testId,
  label,
  title,
  text,
  children,
  className,
  headingLevel = 2,
  width = 'default',
}: {
  id?: string;
  testId?: string;
  label?: string;
  title?: string;
  text?: string;
  children?: ReactNode;
  className?: string;
  headingLevel?: 1 | 2;
  /** Ширина контента (3.1): секции 1120–1240, «Школам» 640–760. */
  width?: 'default' | 'schools';
}) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <section id={id} data-testid={testId} className={cn('px-4 py-12 md:py-16', className)}>
      <div className={cn('mx-auto', width === 'schools' ? 'max-w-[760px]' : 'max-w-[1240px]')}>
        {label ? (
          <p className="text-xs font-semibold tracking-[0.2em] text-[var(--accent)]">{label}</p>
        ) : null}
        {title ? (
          <Heading className="mt-2 text-3xl font-bold tracking-tight md:text-5xl">{title}</Heading>
        ) : null}
        {text ? <p className="mt-4 max-w-2xl text-lg text-[var(--text-muted)]">{text}</p> : null}
        {children ? <div className={cn(title || text ? 'mt-8' : undefined)}>{children}</div> : null}
      </div>
    </section>
  );
}

export function CardGrid({ children, columns = 3 }: { children: ReactNode; columns?: 2 | 3 | 4 }) {
  const cols = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-2 lg:grid-cols-4' }[columns];
  return <ul className={cn('grid gap-4', cols)}>{children}</ul>;
}

export function InfoCard({
  title,
  text,
  icon,
  id,
  children,
}: {
  title: string;
  text?: string;
  icon?: ReactNode;
  id?: string;
  children?: ReactNode;
}) {
  return (
    <li
      id={id}
      className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-card"
    >
      {icon ? (
        <span aria-hidden="true" className="text-[var(--accent)]">
          {icon}
        </span>
      ) : null}
      <h3 className="text-lg font-semibold">{title}</h3>
      {text ? <p className="text-sm text-[var(--text-muted)]">{text}</p> : null}
      {children}
    </li>
  );
}

const buttonBase =
  'inline-flex min-h-[var(--control-h)] items-center justify-center rounded-[var(--radius-pill)] px-6 text-sm font-semibold active:scale-[0.98]';

/** Ссылка-кнопка: белая (primary-white) или вторичная (3.2). */
export function LinkButton({
  href,
  children,
  variant = 'white',
}: {
  href: string;
  children: ReactNode;
  variant?: 'white' | 'blue' | 'secondary' | 'text';
}) {
  const styles = {
    white: 'bg-white text-[#070707] shadow-card hover:bg-white/90',
    blue: 'bg-[var(--accent-strong)] text-white shadow-accent hover:brightness-110',
    secondary:
      'border border-[var(--border)] text-[var(--text)] hover:border-[var(--border-strong)] hover:bg-[var(--field)]',
    text: 'px-0 text-[var(--accent)] underline-offset-4 hover:underline',
  }[variant];
  return (
    <AppLink href={href} className={cn(buttonBase, styles)}>
      {children}
    </AppLink>
  );
}

/** Заглушка ещё не реализованного блока (PH-24) — например, формы итерации 4. */
export function PendingBlock({ text }: { text: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--border)] p-8 text-center text-[var(--text-muted)]">
      {text}
    </div>
  );
}
