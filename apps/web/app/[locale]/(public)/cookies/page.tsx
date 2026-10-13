import { setRequestLocale } from 'next-intl/server';
import { LegalPage } from '@/components/public/legal-page';

/** /cookies — правовой документ (8.1.8, PH-14, PH-43). */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <LegalPage doc="cookies" />;
}
