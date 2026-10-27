/**
 * Адреса модуля «Mendeleev Atlas» (REQ-ATL-01, docs/ATLAS_MAP.md, раздел 2): у каждого раздела и окна — свой адрес,
 * чтобы работали «назад», ссылки, обновление страницы и задания учителя.
 */
export const ATLAS_SCREENS = [
  'home',
  'explore',
  'scientists',
  'learn',
  'search',
  'glossary',
  'syntara',
] as const;
export type AtlasScreen = (typeof ATLAS_SCREENS)[number];

/** Сегмент адреса раздела (`learn` — квиз «Проверь знания» по адресу /quiz, `syntara` — /ai). */
const SEGMENT: Record<AtlasScreen, string> = {
  home: '',
  explore: 'explore',
  scientists: 'scientists',
  learn: 'quiz',
  search: 'search',
  glossary: 'glossary',
  syntara: 'ai',
};

export interface AtlasRoute {
  screen: AtlasScreen;
  /** Окно элемента (/explore/:code) или учёного (/scientists/:code). */
  code?: string;
  /** Тест элемента (/explore/:code/test) или урока «Учёные-химики» (/scientists/test). */
  test?: boolean;
}

const CODE = /^[a-z0-9-]{1,60}$/;

/** Сегменты после /learn/subjects/:id → экран; неизвестный адрес → null (404). */
export function parseAtlasPath(segments: string[]): AtlasRoute | null {
  const [first, second, third, ...rest] = segments;
  if (rest.length) return null;
  if (first === undefined) return { screen: 'home' };
  if (first === 'explore') {
    if (second === undefined) return { screen: 'explore' };
    if (!CODE.test(second)) return null;
    if (third === undefined) return { screen: 'explore', code: second };
    return third === 'test' ? { screen: 'explore', code: second, test: true } : null;
  }
  if (first === 'scientists') {
    if (third !== undefined) return null;
    if (second === undefined) return { screen: 'scientists' };
    if (second === 'test') return { screen: 'scientists', test: true };
    return CODE.test(second) ? { screen: 'scientists', code: second } : null;
  }
  if (second !== undefined) return null;
  const screen = (Object.keys(SEGMENT) as AtlasScreen[]).find((s) => s !== 'home' && SEGMENT[s] === first);
  return screen ? { screen } : null;
}

export function atlasHref(subjectId: string, screen: AtlasScreen, extra = ''): string {
  const segment = SEGMENT[screen];
  return `/learn/subjects/${subjectId}${segment ? `/${segment}` : ''}${extra}`;
}

export const elementHref = (subjectId: string, code: string, test = false) =>
  atlasHref(subjectId, 'explore', `/${code}${test ? '/test' : ''}`);

export const scientistHref = (subjectId: string, code: string) =>
  atlasHref(subjectId, 'scientists', `/${code}`);

/** Ключ данных атласа (API-S-23 / API-PUB-15) — общий для браузера и предзагрузки на сервере. */
export const atlasQueryKey = (subjectId: string, guest: boolean, locale: string) =>
  ['atlas', subjectId, guest, locale] as const;
