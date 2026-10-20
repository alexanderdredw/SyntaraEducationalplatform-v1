import { setRequestLocale } from 'next-intl/server';
import { StudentGame } from '@/components/battle/student-game';
import { requireOwned } from '@/lib/require-owned';

/** /learn/battles/:sid (8.6.2, REQ-BTL-S02…S06): игра ученика; только участник (BR-BTL-12). */
export default async function Page({ params }: { params: Promise<{ locale: string; sid: string }> }) {
  const { locale, sid } = await params;
  setRequestLocale(locale);
  await requireOwned(`/api/student/battle-sessions/${encodeURIComponent(sid)}`);
  return <StudentGame sessionId={sid} />;
}
