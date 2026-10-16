import { setRequestLocale } from 'next-intl/server';
import { TeacherCourses } from '@/components/teacher/courses';

/** /teacher/courses: «Мои курсы» (API-T-01, минимальная версия PH-24). */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <TeacherCourses />;
}
