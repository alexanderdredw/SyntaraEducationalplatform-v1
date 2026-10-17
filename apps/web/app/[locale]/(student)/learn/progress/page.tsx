import { setRequestLocale } from 'next-intl/server';
import { StudentProgress } from '@/components/learn/student-progress';

/** /learn/progress (8.4.6, U08): «Мои показатели». */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <StudentProgress timeZone={process.env.PLATFORM_TZ ?? 'Asia/Almaty'} />;
}
