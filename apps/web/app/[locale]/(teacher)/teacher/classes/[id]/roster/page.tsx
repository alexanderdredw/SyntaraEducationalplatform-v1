import { setRequestLocale } from 'next-intl/server';
import { Card } from '@syntara/ui';
import { ClassRoster } from '@/components/cabinet/class-roster';

/** «Ростер» (REQ-TCH-AN-01, API-T-26): минимальный список учеников класса; полная страница — PH-24. */
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return (
    <Card data-testid="class-roster-tab">
      <ClassRoster classId={id} />
    </Card>
  );
}
