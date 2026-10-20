import { setRequestLocale } from 'next-intl/server';
import { TeacherBattles } from '@/components/battle/teacher-battles';
import { StubPage } from '@/components/public/stub-page';

/** /teacher/battles (8.6.1, REQ-BTL-T01): «Мои Battle» — вкладки «Тесты» и «История игр» (`?tab=history`). */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  setRequestLocale((await params).locale);
  const tab = (await searchParams).tab === 'history' ? 'history' : 'tests';
  return (
    <TeacherBattles
      tab={tab}
      timeZone={process.env.PLATFORM_TZ ?? 'Asia/Almaty'}
      // История игр — этап B5 (API-BTL-29); до него — заглушка PH-24.
      history={<StubPage />}
    />
  );
}
