import { cookies } from 'next/headers';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getMe } from '@/lib/api/server';
import { JoinFlow } from '@/components/auth/join-flow';
import { AuthBackdrop } from '@/components/shell/auth-backdrop';

/** /join (REQ-GEN-AUTH-03, раздел 4: гость → вход, ученик — вступление). */
export default async function JoinPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('join');
  const me = await getMe((await cookies()).toString());
  const viewer = !me ? 'guest' : me.roles.includes('student') ? 'student' : 'other';
  return (
    <AuthBackdrop>
      <section data-testid="join-page" className="px-4 py-12 md:py-16">
        <div className="mx-auto max-w-[560px]">
          <h1 className="text-page-title font-bold">{t('title')}</h1>
          <div className="mt-8">
            <JoinFlow viewer={viewer} />
          </div>
        </div>
      </section>
    </AuthBackdrop>
  );
}
