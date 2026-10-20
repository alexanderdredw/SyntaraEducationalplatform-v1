import { setRequestLocale } from 'next-intl/server';
import { TeacherBattles } from '@/components/battle/teacher-battles';
import { TeacherBattleHistory } from '@/components/battle/teacher-results';

/**
 * /teacher/battles (8.6.1, REQ-BTL-T01): «Мои Battle» — вкладки «Тесты» и «История игр» (`?tab=history`).
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  setRequestLocale((await params).locale);
  const { tab } = await searchParams;
  const timeZone = process.env.PLATFORM_TZ ?? 'Asia/Almaty';
  return (
    <TeacherBattles
      tab={tab === 'history' ? 'history' : 'tests'}
      timeZone={timeZone}
      history={<TeacherBattleHistory timeZone={timeZone} />}
    />
  );
}
