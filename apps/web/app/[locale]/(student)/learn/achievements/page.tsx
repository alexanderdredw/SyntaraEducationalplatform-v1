import { setRequestLocale } from 'next-intl/server';
import { StudentAchievements } from '@/components/learn/student-achievements';

/** /learn/achievements (8.4.7, U10): «Достижения». */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <StudentAchievements />;
}
