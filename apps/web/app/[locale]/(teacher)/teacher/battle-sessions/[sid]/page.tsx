import { setRequestLocale } from 'next-intl/server';
import { HostGame } from '@/components/battle/host-game';
import { requireOwned } from '@/lib/require-owned';

/** /teacher/battle-sessions/:sid (8.6.1, REQ-BTL-T04…T08, T10): экран ведущего; только ведущий (BR-BTL-12). */
export default async function Page({ params }: { params: Promise<{ locale: string; sid: string }> }) {
  const { locale, sid } = await params;
  setRequestLocale(locale);
  await requireOwned(`/api/teacher/battle-sessions/${encodeURIComponent(sid)}`);
  return <HostGame sessionId={sid} />;
}
