import { setRequestLocale } from 'next-intl/server';
import { ClassMastery } from '@/components/teacher/class-mastery';

/** «Карта освоения» (REQ-TCH-AN-01, API-T-29): ученики × темы выбранного предмета. */
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <ClassMastery classId={id} />;
}
