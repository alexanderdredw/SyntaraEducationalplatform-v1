import localFont from 'next/font/local';

/**
 * Space Grotesk — шрифт заголовков «Mendeleev Atlas» (REQ-ATL-06.1): локально, без Google Fonts (набор latin, как
 * в оригинале). В шрифте нет кириллицы — как в оригинале, русские и казахские буквы рисуются следующим шрифтом
 * стека, поэтому запасной шрифт next/font с метриками Arial отключён (adjustFontFallback: false).
 */
export const spaceGrotesk = localFont({
  src: '../../../node_modules/@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2',
  weight: '300 700',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  variable: '--font-space-grotesk',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
    },
  ],
});
