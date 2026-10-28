'use client';

import { type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { loginEntryHref } from '@/lib/auth';
import { usePathname } from '@/i18n/navigation';
import { AppLink } from '../../app-link';
import { useLearnViewer } from '../../learn/viewer';

export type Viewer = 'student' | 'guest' | 'teacher';

/**
 * Кто смотрит атлас: ученик, учитель (предпросмотр, BR-VIS-04: тесты проходит без записи — API-T-32, API-T-34) или
 * гость.
 */
export function useAtlasViewer(): Viewer {
  const { guest, teacher } = useLearnViewer();
  return !guest ? 'student' : teacher ? 'teacher' : 'guest';
}

/**
 * REQ-ATL-06.5: тест, квиз и ИИ — только после входа. Гостю — приглашение платформы войти с возвратом на этот адрес
 * (тексты REQ-ST-LES-06), в стиле атласа.
 */
export function GuestInvite({ ai = false }: { ai?: boolean }) {
  const t = useTranslations('student.lesson');
  const pathname = usePathname();
  return (
    <div className="quiz-intro" data-testid="atlas-guest-invite" style={{ textAlign: 'center' }}>
      <p className="hero-subtitle" style={{ fontSize: '1.1rem', marginBottom: '1.5rem' }}>
        {t(ai ? 'guestInviteAi' : 'guestInvite')}
      </p>
      <AppLink href={loginEntryHref(pathname)} className="btn btn-primary" data-testid="atlas-guest-login">
        {t('guestLogin')}
      </AppLink>
    </div>
  );
}

/** Пояснение предпросмотра учителя: «результаты не записываются» (решение 2026-10-28); ИИ недоступен (А-9). */
export function PreviewNote({ children }: { children: ReactNode }) {
  return (
    <p
      data-testid="atlas-preview-note"
      style={{
        color: 'var(--text-secondary)',
        fontSize: '0.9rem',
        marginBottom: '1rem',
        textAlign: 'center',
      }}
    >
      {children}
    </p>
  );
}
