import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { getMe } from '@/lib/api/server';
import { TicketsQueue } from '@/components/staff/tickets-queue';

/** /staff/tickets (8.5): очередь обращений — только support_agent. */
export default async function StaffTicketsPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const me = await getMe((await cookies()).toString());
  if (!me?.roles.includes('support_agent')) notFound();
  return <TicketsQueue meId={me.id} timeZone={process.env.PLATFORM_TZ ?? 'Asia/Almaty'} />;
}
