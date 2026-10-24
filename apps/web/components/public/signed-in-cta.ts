import 'server-only';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { getMe, getMeStats } from '@/lib/api/server';
import { HOME_BY_ROLE, workspaceRole, type WorkspaceRole } from '@/lib/auth';

export interface SignedInCta {
  role: WorkspaceRole;
  href: string;
  label: string;
}

/**
 * REQ-NAV-05: кнопка вместо гостевых «Войти», «Начать», «Зарегистрироваться» на публичных страницах у вошедшего:
 * ученику — «Продолжить учёбу →» (последняя открытая тема, иначе каталог; REQ-ST-HOME-01, PH-34),
 * учителю — «Перейти в кабинет →». Гостю и служебным ролям — null (кнопки «обложки» без изменений).
 */
export async function getSignedInCta(): Promise<SignedInCta | null> {
  const cookieHeader = (await cookies()).toString();
  const role = workspaceRole(await getMe(cookieHeader));
  if (!role) return null;
  if (role === 'teacher') {
    const t = await getTranslations('cabinet');
    return { role, href: HOME_BY_ROLE.teacher, label: t('toCabinet') };
  }
  const t = await getTranslations('home');
  const stats = await getMeStats(cookieHeader);
  const href = stats.continueTopicId ? `/learn/topics/${stats.continueTopicId}` : '/learn/subjects';
  return { role, href, label: t('hero.continue') };
}
