import localFont from 'next/font/local';

/*
 * Шрифт Inter (решение Q-14) через next/font/local (OPT-05, О4-3): те же файлы @fontsource-variable/inter,
 * font-display: swap, preload нужных наборов и подстроенный по метрикам Inter запасной шрифт — без сдвига
 * текста при подмене (CLS). Каждый набор символов — отдельное начертание со своим unicode-range: браузер
 * скачивает только наборы, символы которых есть на странице. Кириллица и cyrillic-ext содержат казахские
 * буквы Ә Ғ Қ Ң Ө Ұ Ү Һ І; latin-ext — знак тенге ₸. Греческий и вьетнамский наборы не нужны.
 * Параметры next/font должны быть литералами — пути к файлам записаны полностью.
 */
export const interCyrillic = localFont({
  src: '../node_modules/@fontsource-variable/inter/files/inter-cyrillic-wght-normal.woff2',
  weight: '100 900',
  display: 'swap',
  adjustFontFallback: false,
  variable: '--font-inter-cyrillic',
  declarations: [{ prop: 'unicode-range', value: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' }],
});

export const interCyrillicExt = localFont({
  src: '../node_modules/@fontsource-variable/inter/files/inter-cyrillic-ext-wght-normal.woff2',
  weight: '100 900',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  variable: '--font-inter-cyrillic-ext',
  declarations: [
    { prop: 'unicode-range', value: 'U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F' },
  ],
});

export const interLatinExt = localFont({
  src: '../node_modules/@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2',
  weight: '100 900',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  variable: '--font-inter-latin-ext',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
    },
  ],
});

// Последний в стеке: его переменная содержит и запасной Arial с метриками Inter.
export const interLatin = localFont({
  src: '../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  weight: '100 900',
  display: 'swap',
  adjustFontFallback: 'Arial',
  variable: '--font-inter-latin',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
    },
  ],
});

export const fontVariables = [interCyrillic, interCyrillicExt, interLatinExt, interLatin]
  .map((f) => f.variable)
  .join(' ');
