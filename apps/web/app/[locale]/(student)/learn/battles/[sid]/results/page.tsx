import { setRequestLocale } from 'next-intl/server';
import { StudentResults } from '@/components/battle/student-results';
import { requireOwned } from '@/lib/require-owned';

/** /learn/battles/:sid/results (8.6.2, REQ-BTL-S06): итоги игры ученика и «Мои ответы». */
export default async function Page({ params }: { params: Promise<{ locale: string; sid: string }> }) {
  const { locale, sid } = await params;
  setRequestLocale(locale);
  await requireOwned(`/api/student/battle-sessions/${encodeURIComponent(sid)}`);
  return <StudentResults sessionId={sid} />;
}
