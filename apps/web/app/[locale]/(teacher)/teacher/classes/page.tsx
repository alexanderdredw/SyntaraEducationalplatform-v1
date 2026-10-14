import { setRequestLocale } from 'next-intl/server';
import { TeacherClasses } from '@/components/cabinet/teacher-classes';

/** /teacher/classes (раздел 4): классы учителя, коды подключения (API-T-04..06). Аналитика — итерация 10. */
export default async function TeacherClassesPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <TeacherClasses timeZone={process.env.PLATFORM_TZ ?? 'Asia/Almaty'} />;
}
