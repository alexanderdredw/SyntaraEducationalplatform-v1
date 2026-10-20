import { setRequestLocale } from 'next-intl/server';
import { StudentBattles } from '@/components/battle/student-join';

/** /learn/battles (8.6.2, REQ-BTL-S01): вход в Battle по коду и «Мои Battle». */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <StudentBattles timeZone={process.env.PLATFORM_TZ ?? 'Asia/Almaty'} />;
}
