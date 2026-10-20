import { setRequestLocale } from 'next-intl/server';
import { TeacherBattleResults } from '@/components/battle/teacher-results';
import { requireOwned } from '@/lib/require-owned';

/** /teacher/battle-sessions/:sid/results (8.6.1, REQ-BTL-T09): результаты игры; только ведущий. */
export default async function Page({ params }: { params: Promise<{ locale: string; sid: string }> }) {
  const { locale, sid } = await params;
  setRequestLocale(locale);
  await requireOwned(`/api/teacher/battle-sessions/${encodeURIComponent(sid)}/results`);
  return <TeacherBattleResults sessionId={sid} timeZone={process.env.PLATFORM_TZ ?? 'Asia/Almaty'} />;
}
