import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { ProfileEditor } from '@/components/account/profile-editor';
import { workspaceRole } from '@/lib/auth';
import { requireUser } from '@/lib/require-user';

/** /account/profile — «Редактировать профиль» (REQ-PRF-05). Только ученик и учитель (служебные роли — 404). */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!workspaceRole(await requireUser(locale))) notFound();
  return <ProfileEditor timeZone={process.env.PLATFORM_TZ ?? 'Asia/Almaty'} />;
}
