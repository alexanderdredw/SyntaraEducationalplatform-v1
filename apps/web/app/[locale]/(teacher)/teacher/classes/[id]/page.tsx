import { redirect } from 'next/navigation';

/** /teacher/classes/:id → «Аналитика класса» (8.3.7). */
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  redirect(`/${locale}/teacher/classes/${id}/analytics`);
}
