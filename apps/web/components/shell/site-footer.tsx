import { getTranslations } from 'next-intl/server';
import { AppLink } from '../app-link';

/**
 * Футер (REQ-GEN-SHELL-05): бренд, ПРОДУКТ, ШКОЛАМ, ПРАВОВОЕ, нижняя строка.
 * В кабинетах «Войти» и «Подключиться к классу» заменяются на «Кабинет» (итерация 6).
 */
export async function SiteFooter({ supportEmail }: { supportEmail: string | null }) {
  const t = await getTranslations();
  const linkClass = 'inline-flex min-h-11 items-center text-white/85 hover:text-white hover:underline';
  const column = (title: string, links: Array<[string, string]>) => (
    <nav aria-label={title}>
      <h2 className="text-xs font-semibold tracking-widest text-white/70">{title}</h2>
      <ul className="mt-3">
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
      <div className="mx-auto grid max-w-[1240px] gap-8 px-4 py-12 md:grid-cols-4">
        <div>
          <p className="text-xl font-bold">Syntara</p>
          <p className="mt-3 text-sm text-white/85">{t('footer.tagline')}</p>
          {supportEmail ? (
            <a href={`mailto:${supportEmail}`} className={linkClass}>
              {supportEmail}
            </a>
          ) : null}
          <p className="mt-2 text-sm text-white/85">{t('footer.languages')}</p>
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
          ['/auth/login', t('shell.login')],
          ['/join', t('footer.joinClass')],
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
