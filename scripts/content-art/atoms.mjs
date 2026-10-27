// Собственные схемы атомов для уроков «Химии» (решение владельца В-5, docs/CHEM_MAP.md 5.2): модель Бора —
// ядро с символом элемента и электроны по оболочкам; других надписей на картинке нет (язык не важен), лицензия own.
// Схему рисует конвертер scripts/content-import/atlas-chemistry.mjs: SVG → WebP (sharp).

/** Электроны по оболочкам K, L, M, N, O, P (основное состояние) — элементы 1–60. */
export const SHELLS = {
  1: [1],
  2: [2],
  3: [2, 1],
  4: [2, 2],
  5: [2, 3],
  6: [2, 4],
  7: [2, 5],
  8: [2, 6],
  9: [2, 7],
  10: [2, 8],
  11: [2, 8, 1],
  12: [2, 8, 2],
  13: [2, 8, 3],
  14: [2, 8, 4],
  15: [2, 8, 5],
  16: [2, 8, 6],
  17: [2, 8, 7],
  18: [2, 8, 8],
  19: [2, 8, 8, 1],
  20: [2, 8, 8, 2],
  21: [2, 8, 9, 2],
  22: [2, 8, 10, 2],
  23: [2, 8, 11, 2],
  24: [2, 8, 13, 1],
  25: [2, 8, 13, 2],
  26: [2, 8, 14, 2],
  27: [2, 8, 15, 2],
  28: [2, 8, 16, 2],
  29: [2, 8, 18, 1],
  30: [2, 8, 18, 2],
  31: [2, 8, 18, 3],
  32: [2, 8, 18, 4],
  33: [2, 8, 18, 5],
  34: [2, 8, 18, 6],
  35: [2, 8, 18, 7],
  36: [2, 8, 18, 8],
  37: [2, 8, 18, 8, 1],
  38: [2, 8, 18, 8, 2],
  39: [2, 8, 18, 9, 2],
  40: [2, 8, 18, 10, 2],
  41: [2, 8, 18, 12, 1],
  42: [2, 8, 18, 13, 1],
  43: [2, 8, 18, 13, 2],
  44: [2, 8, 18, 15, 1],
  45: [2, 8, 18, 16, 1],
  46: [2, 8, 18, 18],
  47: [2, 8, 18, 18, 1],
  48: [2, 8, 18, 18, 2],
  49: [2, 8, 18, 18, 3],
  50: [2, 8, 18, 18, 4],
  51: [2, 8, 18, 18, 5],
  52: [2, 8, 18, 18, 6],
  53: [2, 8, 18, 18, 7],
  54: [2, 8, 18, 18, 8],
  55: [2, 8, 18, 18, 8, 1],
  56: [2, 8, 18, 18, 8, 2],
  57: [2, 8, 18, 18, 9, 2],
  58: [2, 8, 18, 19, 9, 2],
  59: [2, 8, 18, 21, 8, 2],
  60: [2, 8, 18, 22, 8, 2],
};

for (const [z, shells] of Object.entries(SHELLS)) {
  if (shells.reduce((a, b) => a + b, 0) !== Number(z)) throw new Error(`SHELLS[${z}]: сумма не равна номеру`);
}

const SIZE = 800;
const C = SIZE / 2;
const NUCLEUS = 74;
const STEP = 50;

/** SVG-схема атома: прозрачный фон, цвета читаются в светлой и тёмной теме. */
export function atomSvg({ symbol, number }) {
  const shells = SHELLS[number];
  if (!shells) throw new Error(`нет оболочек для элемента ${number}`);
  const parts = [];
  shells.forEach((count, i) => {
    const r = NUCLEUS + STEP * (i + 1);
    parts.push(`<circle cx="${C}" cy="${C}" r="${r}" fill="none" stroke="#94a3b8" stroke-width="3"/>`);
    // Электроны равномерно по орбите; каждая следующая оболочка чуть повёрнута, чтобы точки не выстраивались в линию.
    const offset = -Math.PI / 2 + i * 0.37;
    for (let k = 0; k < count; k++) {
      const a = offset + (2 * Math.PI * k) / count;
      const x = (C + r * Math.cos(a)).toFixed(1);
      const y = (C + r * Math.sin(a)).toFixed(1);
      parts.push(`<circle cx="${x}" cy="${y}" r="11" fill="#3b82f6" stroke="#dbeafe" stroke-width="3"/>`);
    }
  });
  const fontSize = symbol.length > 1 ? 64 : 76;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
  <!-- Syntara: собственная схема атома (модель Бора), элемент ${number}, лицензия own. -->
  ${parts.join('\n  ')}
  <circle cx="${C}" cy="${C}" r="${NUCLEUS}" fill="#f97316" stroke="#fdba74" stroke-width="4"/>
  <text x="${C}" y="${C}" dy="0.35em" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-weight="700" font-size="${fontSize}" fill="#ffffff">${symbol}</text>
</svg>
`;
}
