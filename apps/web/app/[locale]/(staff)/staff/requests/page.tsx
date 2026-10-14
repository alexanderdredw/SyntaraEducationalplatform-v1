import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { getMe } from '@/lib/api/server';
import { RequestsQueue } from '@/components/staff/requests-queue';

/** /staff/requests (8.5): очередь школьных заявок — только onboarding_agent. */
export default async function StaffRequestsPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const me = await getMe((await cookies()).toString());
  if (!me?.roles.includes('onboarding_agent')) notFound();
  return <RequestsQueue meId={me.id} timeZone={process.env.PLATFORM_TZ ?? 'Asia/Almaty'} />;
}
