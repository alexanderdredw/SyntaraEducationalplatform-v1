'use client';

import { useTranslations } from 'next-intl';
import { Popover } from 'radix-ui';
import { CircleHelp, Lightbulb, MessageCircle, X } from 'lucide-react';
import { FloatingHelp as FloatingHelpFrame } from '@syntara/ui';
import { usePathname } from '@/i18n/navigation';
import { AppLink } from '../app-link';
import { helpKey } from './nav-items';

/**
 * Плавающие кнопки справа внизу (REQ-GEN-SHELL-04): «?» — краткая справка по странице и ссылки поддержки,
 * синяя — публичный помощник (/ai). В кабинетах между ними — жёлтая «лампочка» (PH-32; содержимое — Q-21,
 * пока заглушка PH-24). Поднимаются над cookie-баннером (переменная --cookie-banner-h).
 */
export function FloatingHelp({
  supportEmail,
  lamp = false,
}: {
  supportEmail: string | null;
  lamp?: boolean;
}) {
  const t = useTranslations('help');
  const tc = useTranslations();
  const pathname = usePathname();
  const round =
    'inline-flex size-12 items-center justify-center rounded-full shadow-lg transition hover:brightness-110';

  return (
    <FloatingHelpFrame>
      <Popover.Root>
        <Popover.Trigger
          aria-label={t('open')}
          className={`${round} border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]`}
        >
          <CircleHelp aria-hidden="true" className="size-5" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="top"
            align="end"
            sideOffset={8}
            collisionPadding={16}
            className="z-50 w-[min(90vw,320px)] rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text)] shadow-xl"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-semibold">{t('title')}</h2>
              <Popover.Close
                aria-label={t('title')}
                className="-m-2 inline-flex size-11 items-center justify-center"
              >
                <X aria-hidden="true" className="size-4" />
              </Popover.Close>
            </div>
            <p className="mt-2 text-[var(--text-muted)]">{t(`pages.${helpKey(pathname)}`)}</p>
            <ul className="mt-3 space-y-1">
              <li>
                <AppLink
                  href="/support"
                  className="inline-flex min-h-11 items-center text-[var(--accent)] hover:underline"
                >
                  {t('supportLink')}
                </AppLink>
              </li>
              {supportEmail ? (
                <li>
                  <span className="text-[var(--text-muted)]">{t('emailLabel')}: </span>
                  <a href={`mailto:${supportEmail}`} className="text-[var(--accent)] hover:underline">
                    {supportEmail}
                  </a>
                </li>
              ) : null}
            </ul>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {lamp ? (
        <Popover.Root>
          <Popover.Trigger
            aria-label={tc('cabinet.lamp')}
            data-testid="cabinet-lamp"
            className={`${round} border border-[var(--border)] bg-[var(--surface)] text-[#f5b301]`}
          >
            <Lightbulb aria-hidden="true" className="size-5" />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="left"
              sideOffset={8}
              collisionPadding={16}
              className="z-50 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text)] shadow-xl"
            >
              {tc('common.sectionInDevelopment')}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ) : null}
      <AppLink
        href="/ai"
        aria-label={t('assistant')}
        className={`${round} bg-[var(--accent-strong)] text-white`}
      >
        <MessageCircle aria-hidden="true" className="size-5" />
      </AppLink>
    </FloatingHelpFrame>
  );
}
