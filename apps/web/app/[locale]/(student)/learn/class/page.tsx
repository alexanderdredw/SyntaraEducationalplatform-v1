import { setRequestLocale } from 'next-intl/server';
import { MyClass } from '@/components/learn/my-class';

/** /learn/class (docs/NAV_TZ_2.md, REQ-NAV-11): «Мой класс». */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <MyClass timeZone={process.env.PLATFORM_TZ ?? 'Asia/Almaty'} />;
}
