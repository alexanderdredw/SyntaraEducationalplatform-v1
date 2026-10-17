import { setRequestLocale } from 'next-intl/server';
import { StudentAssignments } from '@/components/learn/student-assignments';

/** /learn/assignments (8.4.8, PH-33): «Мои задания». */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <StudentAssignments timeZone={process.env.PLATFORM_TZ ?? 'Asia/Almaty'} />;
}
