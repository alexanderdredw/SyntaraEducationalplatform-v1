'use client';

import { useTranslations } from 'next-intl';
import { type LoginEntry } from '@syntara/shared';
import { safeReturnTo } from '@/lib/auth';
import { AppLink } from '../app-link';

/** Экран входа для роли (BR-AUTH-01), с возвратом returnTo. */
export function loginEntryFor(entry: LoginEntry, returnTo?: string | null): string {
  const target = safeReturnTo(returnTo);
  const back = target !== '/' ? `&returnTo=${encodeURIComponent(target)}` : '';
  return entry === 'student' ? `/auth/start?role=student${back}` : `/auth/login?role=teacher${back}`;
}

/**
 * 403 wrongRoleForLogin (BR-AUTH-01): «Это аккаунт ученика. Войди через „Я ученик“» / «Это аккаунт учителя. Войди
 * через „Я учитель“» — со ссылкой на нужный экран входа. Сессия не создана.
 */
export function WrongRoleMessage({
  expected,
  returnTo,
  testId,
}: {
  expected: LoginEntry;
  returnTo?: string | null;
  testId: string;
}) {
  const t = useTranslations('auth.login');
  return (
    <p
      role="alert"
      data-testid={testId}
      data-expected={expected}
      className="text-sm text-[var(--danger-text)]"
    >
      {t.rich(expected === 'student' ? 'wrongRoleStudent' : 'wrongRoleTeacher', {
        link: (chunks) => (
          <AppLink href={loginEntryFor(expected, returnTo)} className="font-semibold underline">
            {chunks}
          </AppLink>
        ),
      })}
    </p>
  );
}

/** Ответ 403 входа → ожидаемая форма или null. */
export function wrongRoleOf(result: {
  kind: string;
  status?: number;
  error?: { fieldErrors?: Record<string, string>; expectedEntry?: LoginEntry };
}): LoginEntry | null {
  if (result.kind !== 'http' || result.status !== 403) return null;
  if (result.error?.fieldErrors?.login !== 'wrongRoleForLogin') return null;
  return result.error.expectedEntry ?? null;
}
