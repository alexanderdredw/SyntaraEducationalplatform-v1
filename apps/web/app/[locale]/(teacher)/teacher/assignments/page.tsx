import { setRequestLocale } from 'next-intl/server';
import { TeacherAssignmentsPage } from '@/components/teacher/assignments-page';

/** /teacher/assignments (8.3.6, T09): выдача заданий классу, выданные задания, проверка. */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <TeacherAssignmentsPage timeZone={process.env.PLATFORM_TZ ?? 'Asia/Almaty'} />;
}
