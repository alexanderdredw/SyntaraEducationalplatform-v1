import { getTranslations } from 'next-intl/server';
import { BrandMark } from '@syntara/ui';
import { AppLink } from '../app-link';

/**
 * Футер (REQ-GEN-SHELL-05): бренд, ПРОДУКТ, ШКОЛАМ, ПРАВОВОЕ, нижняя строка.
 * В кабинетах «Войти» и «Подключиться к классу» заменяются на «Кабинет» (`cabinetHref`).
 */
export async function SiteFooter({
  supportEmail,
  cabinetHref,
}: {
  supportEmail: string | null;
  cabinetHref?: string;
}) {
  const t = await getTranslations();
  const linkClass =
    'inline-flex min-h-11 items-center text-[15px] text-white/90 hover:text-white hover:underline';
  const column = (title: string, links: Array<[string, string]>) => (
    <nav aria-label={title}>
      <h2 className="text-xs font-semibold tracking-[0.18em] text-white/75">{title}</h2>
      <ul className="mt-2">
        {links.map(([href, label]) => (
          <li key={href}>
            <AppLink href={href} className={linkClass}>
              {label}
            </AppLink>
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <footer data-testid="site-footer" className="bg-[linear-gradient(160deg,#1765e8,#0b3a91)] text-white">
      <div className="mx-auto grid max-w-[1140px] gap-8 px-4 pb-12 pt-20 md:grid-cols-[2fr_1fr_1fr_1.3fr] md:px-8">
        <div>
          <p className="flex items-center gap-2 text-xl font-bold">
            <BrandMark size="sm" />
            Syntara
          </p>
          <p className="mt-3 max-w-[320px] text-[15px] text-white/90">{t('footer.tagline')}</p>
          {supportEmail ? (
            <a href={`mailto:${supportEmail}`} className={linkClass}>
              {supportEmail}
            </a>
          ) : null}
          <p className="mt-2 text-xs tracking-[0.18em] text-white/75">{t('footer.languages')}</p>
        </div>
        {column(t('footer.product'), [
          ['/', t('shell.nav.home')],
          ['/subjects', t('shell.nav.subjects')],
          ['/about', t('shell.nav.about')],
          ['/ai', t('shell.nav.ai')],
        ])}
        {column(t('footer.schools'), [
          ['/schools', t('shell.nav.schools')],
          ['/schools/request', t('footer.requestSchool')],
          ['/support', t('shell.nav.help')],
          ...((cabinetHref
            ? [[cabinetHref, t('footer.cabinet')]]
            : [
                ['/auth/login', t('shell.login')],
                ['/join', t('footer.joinClass')],
              ]) as Array<[string, string]>),
        ])}
        {column(t('footer.legal'), [
          ['/terms', t('legal.terms')],
          ['/privacy', t('legal.privacy')],
          ['/cookies', t('legal.cookies')],
        ])}
      </div>
      <div className="border-t border-white/20 px-4 py-4 text-center text-sm text-white/85">
        {t('footer.copyright')}
      </div>
    </footer>
  );
}
