import { setRequestLocale } from 'next-intl/server';
import { StubPage } from '@/components/public/stub-page';

/** Заглушка PH-24: /auth/start (REQ-GEN-AUTH-02) — итерация 6. */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <StubPage />;
}
