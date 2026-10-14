import { setRequestLocale } from 'next-intl/server';
import { StubPage } from '@/components/public/stub-page';

/** Заглушка PH-24: раздел кабинета появится в следующих итерациях (раздел 12). */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <StubPage />;
}
