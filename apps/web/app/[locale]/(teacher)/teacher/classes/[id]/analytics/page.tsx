import { setRequestLocale } from 'next-intl/server';
import { ClassAnalytics } from '@/components/teacher/class-analytics';

/** «Аналитика класса» (8.3.7, T10, API-T-25). */
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <ClassAnalytics classId={id} />;
}
