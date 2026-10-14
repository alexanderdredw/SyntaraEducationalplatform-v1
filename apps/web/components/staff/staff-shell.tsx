import { type ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { type Locale } from '@syntara/shared';
import { getPublicConfig, type Me } from '@/lib/api/server';
import { AppLink } from '../app-link';
import { LanguageSwitcher, ThemeToggle } from '../shell/preference-controls';
import { LogoutButton } from './logout-button';
import { StaffNav } from './staff-nav';

/**
 * Оболочка служебной поддержки (8.5): очереди по ролям, имя сотрудника, выход.
 * ИИ-помощник здесь не используется (REQ-SUP-04).
 */
export async function StaffShell({ me, children }: { me: Me; children: ReactNode }) {
  const t = await getTranslations('staff');
  const config = await getPublicConfig();
  const enabledLocales: Locale[] = config?.features.enabledLocales ?? ['ru', 'kk', 'en'];
  const items = [
    ...(me.roles.includes('support_agent') ? [{ href: '/staff/tickets', label: t('tickets') }] : []),
    ...(me.roles.includes('onboarding_agent') ? [{ href: '/staff/requests', label: t('requests') }] : []),
  ];
  return (
    <>
      <header
        data-testid="staff-header"
        className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg)]/95 backdrop-blur"
      >
        <div className="mx-auto flex min-h-[var(--header-h)] max-w-[1600px] flex-wrap items-center gap-3 px-4 py-2">
          <AppLink
            href="/"
            className="inline-flex min-h-11 shrink-0 items-center text-xl font-bold tracking-tight"
          >
            Syntara
          </AppLink>
          <StaffNav label={t('navLabel')} items={items} />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span data-testid="staff-user" className="text-sm text-[var(--text-muted)]">
              {me.displayName}
            </span>
            <LanguageSwitcher enabledLocales={enabledLocales} />
            <ThemeToggle />
            <LogoutButton label={t('logout')} />
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1600px] px-4 py-6 outline-none">
        {children}
      </main>
    </>
  );
}
