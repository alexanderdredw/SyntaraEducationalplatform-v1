/** Пункты публичного меню (REQ-GEN-SHELL-01): «Помощь» ведёт на /support. */
export const NAV_ITEMS = [
  { key: 'home', href: '/' },
  { key: 'subjects', href: '/subjects' },
  { key: 'about', href: '/about' },
  { key: 'ai', href: '/ai' },
  { key: 'schools', href: '/schools' },
  { key: 'help', href: '/support' },
] as const;

export type NavKey = (typeof NAV_ITEMS)[number]['key'];

/** Активный пункт: точное совпадение для «/», иначе — по префиксу раздела. */
export function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Ключ краткой справки по текущей странице. */
export function helpKey(pathname: string): string {
  if (pathname === '/') return 'home';
  if (pathname.startsWith('/schools/request')) return 'schoolsRequest';
  const first = pathname.split('/')[1] ?? '';
  if (['subjects', 'about', 'ai', 'schools', 'support'].includes(first)) return first;
  if (['terms', 'privacy', 'cookies'].includes(first)) return 'legal';
  return 'stub';
}
