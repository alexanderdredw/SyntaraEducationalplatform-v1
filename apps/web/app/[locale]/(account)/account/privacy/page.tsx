import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PrivacyRequests } from '@/components/auth/privacy-requests';
import { requireUser } from '@/lib/require-user';

const ITEMS = ['account', 'preferences', 'classes', 'learning', 'ai', 'support', 'consents'] as const;

/**
 * /account/privacy (REQ-GEN-AUTH-04): список хранимых данных и запросы копии/удаления (API-ME-05). У ученика и
 * учителя — вкладка «Данные» личного кабинета (REQ-PRF-01); отступы задаёт оболочка (app/(account)/layout).
 */
export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireUser(locale);
  const t = await getTranslations('privacy');
  return (
    <div data-testid="privacy-page" className="flex max-w-[640px] flex-col gap-6">
      <h1 className="text-page-title font-bold">{t('title')}</h1>
      <p className="text-[var(--text-muted)]">{t('intro')}</p>
      <ul className="list-disc space-y-2 pl-5">
        {ITEMS.map((item) => (
          <li key={item}>{t(`items.${item}`)}</li>
        ))}
      </ul>
      <PrivacyRequests timeZone={process.env.PLATFORM_TZ ?? 'Asia/Almaty'} />
    </div>
  );
}
