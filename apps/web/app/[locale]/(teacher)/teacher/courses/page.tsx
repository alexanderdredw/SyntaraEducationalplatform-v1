import { setRequestLocale } from 'next-intl/server';
import { StubPage } from '@/components/public/stub-page';

/** Заглушка PH-24: страница после входа по роли (REQ-GEN-AUTH-01); кабинет — следующие итерации. */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <StubPage />;
}
