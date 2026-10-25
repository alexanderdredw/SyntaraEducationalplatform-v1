import { type ReactNode } from 'react';

/**
 * BR-PRF-02: 24 собственных аватара — животные, предметы, абстрактные персонажи (без людей и брендов).
 * Рисунок на поле 64×64: основная форма — `currentColor` (знак аватара), прорези и детали — `var(--avatar-cut)`
 * (цвет подложки), поэтому аватар одинаково читается в тёмной и светлой темах. Цвет — один из 8 токенов.
 */
export const AVATAR_ART: Record<string, { color: string; art: ReactNode }> = {
  fox: {
    color: 'orange',
    art: (
      <>
        <path d="M13 14 L25 27 H39 L51 14 L49 37 Q32 57 15 37 Z" fill="currentColor" />
        <circle cx="25.5" cy="36" r="2.6" fill="var(--avatar-cut)" />
        <circle cx="38.5" cy="36" r="2.6" fill="var(--avatar-cut)" />
        <path d="M28 44 Q32 48 36 44 L32 41 Z" fill="var(--avatar-cut)" />
      </>
    ),
  },
  owl: {
    color: 'amber',
    art: (
      <>
        <path d="M18 18 L24 24 H40 L46 18 V40 Q46 54 32 54 Q18 54 18 40 Z" fill="currentColor" />
        <circle cx="25.5" cy="33" r="6.5" fill="var(--avatar-cut)" />
        <circle cx="38.5" cy="33" r="6.5" fill="var(--avatar-cut)" />
        <circle cx="25.5" cy="33" r="2.8" fill="currentColor" />
        <circle cx="38.5" cy="33" r="2.8" fill="currentColor" />
        <path d="M29.5 41 H34.5 L32 45.5 Z" fill="var(--avatar-cut)" />
      </>
    ),
  },
  cat: {
    color: 'violet',
    art: (
      <>
        <path d="M16 26 L18 11 L28 21 H36 L46 11 L48 26 Q51 52 32 52 Q13 52 16 26 Z" fill="currentColor" />
        <ellipse cx="25.5" cy="33" rx="2.4" ry="3.4" fill="var(--avatar-cut)" />
        <ellipse cx="38.5" cy="33" rx="2.4" ry="3.4" fill="var(--avatar-cut)" />
        <path d="M30 40 H34 L32 42.5 Z" fill="var(--avatar-cut)" />
        <path
          d="M14 40 L24 41 M14 45 L24 43 M50 40 L40 41 M50 45 L40 43"
          stroke="var(--avatar-cut)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </>
    ),
  },
  bear: {
    color: 'amber',
    art: (
      <>
        <circle cx="19" cy="21" r="7" fill="currentColor" />
        <circle cx="45" cy="21" r="7" fill="currentColor" />
        <circle cx="19" cy="21" r="3" fill="var(--avatar-cut)" />
        <circle cx="45" cy="21" r="3" fill="var(--avatar-cut)" />
        <circle cx="32" cy="36" r="17" fill="currentColor" />
        <circle cx="25" cy="32" r="2.4" fill="var(--avatar-cut)" />
        <circle cx="39" cy="32" r="2.4" fill="var(--avatar-cut)" />
        <ellipse cx="32" cy="42" rx="7.5" ry="5.5" fill="var(--avatar-cut)" />
        <ellipse cx="32" cy="40.5" rx="2.6" ry="2" fill="currentColor" />
      </>
    ),
  },
  rabbit: {
    color: 'pink',
    art: (
      <>
        <ellipse cx="25" cy="18" rx="5" ry="12" fill="currentColor" />
        <ellipse cx="39" cy="18" rx="5" ry="12" fill="currentColor" />
        <ellipse cx="25" cy="18" rx="2" ry="8" fill="var(--avatar-cut)" />
        <ellipse cx="39" cy="18" rx="2" ry="8" fill="var(--avatar-cut)" />
        <circle cx="32" cy="40" r="14" fill="currentColor" />
        <circle cx="26.5" cy="38" r="2.2" fill="var(--avatar-cut)" />
        <circle cx="37.5" cy="38" r="2.2" fill="var(--avatar-cut)" />
        <path d="M29.5 44 H34.5 L32 46.5 Z" fill="var(--avatar-cut)" />
      </>
    ),
  },
  penguin: {
    color: 'slate',
    art: (
      <>
        <ellipse cx="32" cy="35" rx="16" ry="20" fill="currentColor" />
        <ellipse cx="32" cy="39" rx="10" ry="14" fill="var(--avatar-cut)" />
        <circle cx="27.5" cy="29" r="2.2" fill="currentColor" />
        <circle cx="36.5" cy="29" r="2.2" fill="currentColor" />
        <path d="M29 33 H35 L32 37 Z" fill="currentColor" />
      </>
    ),
  },
  whale: {
    color: 'blue',
    art: (
      <>
        <path
          d="M9 36 Q10 22 30 22 Q46 22 49 34 L56 27 V45 L49 40 Q45 50 29 50 Q10 50 9 36 Z"
          fill="currentColor"
        />
        <circle cx="21" cy="33" r="2.6" fill="var(--avatar-cut)" />
        <path
          d="M14 42 Q29 47 44 41"
          stroke="var(--avatar-cut)"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M28 17 Q28 12 24 10 M28 17 Q28 12 32 10"
          stroke="currentColor"
          strokeWidth="2.2"
          fill="none"
          strokeLinecap="round"
        />
      </>
    ),
  },
  turtle: {
    color: 'green',
    art: (
      <>
        <circle cx="13" cy="38" r="5.5" fill="currentColor" />
        <rect x="20" y="40" width="7" height="9" rx="3" fill="currentColor" />
        <rect x="41" y="40" width="7" height="9" rx="3" fill="currentColor" />
        <path d="M17 42 Q17 20 35 20 Q53 20 53 42 Z" fill="currentColor" />
        <path
          d="M35 22 V41 M24 31 L35 27 L46 31 M22 41 L27 31 M48 41 L43 31"
          stroke="var(--avatar-cut)"
          strokeWidth="1.8"
          fill="none"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="36.5" r="1.4" fill="var(--avatar-cut)" />
      </>
    ),
  },
  rocket: {
    color: 'blue',
    art: (
      <>
        <path d="M32 8 Q43 18 43 34 V44 H21 V34 Q21 18 32 8 Z" fill="currentColor" />
        <circle cx="32" cy="27" r="5" fill="var(--avatar-cut)" />
        <path d="M21 34 L13 44 V48 L21 44 Z M43 34 L51 44 V48 L43 44 Z" fill="currentColor" />
        <path d="M26 47 H38 L32 57 Z" fill="currentColor" opacity="0.55" />
      </>
    ),
  },
  book: {
    color: 'teal',
    art: (
      <>
        <path d="M10 18 Q21 15 31 20 V50 Q21 45 10 48 Z" fill="currentColor" />
        <path d="M54 18 Q43 15 33 20 V50 Q43 45 54 48 Z" fill="currentColor" />
        <path
          d="M15 26 Q21 25 26 27 M15 32 Q21 31 26 33 M38 27 Q43 25 49 26 M38 33 Q43 31 49 32"
          stroke="var(--avatar-cut)"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
      </>
    ),
  },
  planet: {
    color: 'violet',
    art: (
      <>
        <circle cx="32" cy="32" r="13" fill="currentColor" />
        <ellipse
          cx="32"
          cy="32"
          rx="24"
          ry="7"
          transform="rotate(-20 32 32)"
          stroke="var(--avatar-cut)"
          strokeWidth="5"
          fill="none"
        />
        <ellipse
          cx="32"
          cy="32"
          rx="24"
          ry="7"
          transform="rotate(-20 32 32)"
          stroke="currentColor"
          strokeWidth="2.4"
          fill="none"
        />
        <circle cx="27" cy="27" r="2.5" fill="var(--avatar-cut)" />
      </>
    ),
  },
  atom: {
    color: 'teal',
    art: (
      <>
        {[0, 60, 120].map((deg) => (
          <ellipse
            key={deg}
            cx="32"
            cy="32"
            rx="22"
            ry="8.5"
            transform={`rotate(${deg} 32 32)`}
            stroke="currentColor"
            strokeWidth="2.6"
            fill="none"
          />
        ))}
        <circle cx="32" cy="32" r="5" fill="currentColor" />
      </>
    ),
  },
  compass: {
    color: 'slate',
    art: (
      <>
        <circle cx="32" cy="32" r="20" fill="currentColor" />
        <circle cx="32" cy="32" r="15.5" fill="var(--avatar-cut)" />
        <path d="M32 18 L37 32 H27 Z" fill="currentColor" />
        <path
          d="M32 46 L37 32 H27 Z"
          stroke="currentColor"
          strokeWidth="1.8"
          fill="none"
          strokeLinejoin="round"
        />
        <circle cx="32" cy="32" r="2.2" fill="currentColor" />
      </>
    ),
  },
  leaf: {
    color: 'green',
    art: (
      <>
        <path d="M14 50 Q12 16 50 12 Q54 46 14 50 Z" fill="currentColor" />
        <path
          d="M16 48 L44 20 M26 38 L25 28 M26 38 L36 39 M35 29 L34 22 M35 29 L42 30"
          stroke="var(--avatar-cut)"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      </>
    ),
  },
  bulb: {
    color: 'amber',
    art: (
      <>
        <path d="M32 9 Q48 9 48 25 Q48 34 40 40 V44 H24 V40 Q16 34 16 25 Q16 9 32 9 Z" fill="currentColor" />
        <path
          d="M27 36 V28 L32 32 L37 28 V36"
          stroke="var(--avatar-cut)"
          strokeWidth="2"
          fill="none"
          strokeLinejoin="round"
        />
        <rect x="24" y="46" width="16" height="4" rx="2" fill="currentColor" />
        <rect x="27" y="52" width="10" height="4" rx="2" fill="currentColor" />
      </>
    ),
  },
  palette: {
    color: 'pink',
    art: (
      <>
        <path
          d="M32 10 Q54 10 54 30 Q54 40 44 40 H40 Q35 40 37 46 Q39 54 30 54 Q10 52 10 32 Q10 10 32 10 Z"
          fill="currentColor"
        />
        <circle cx="22" cy="26" r="3.6" fill="var(--avatar-cut)" />
        <circle cx="32" cy="19" r="3.6" fill="var(--avatar-cut)" />
        <circle cx="43" cy="24" r="3.6" fill="var(--avatar-cut)" />
        <circle cx="21" cy="38" r="3.6" fill="var(--avatar-cut)" />
      </>
    ),
  },
  robot: {
    color: 'blue',
    art: (
      <>
        <path d="M32 9 V16" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="32" cy="8" r="3.2" fill="currentColor" />
        <rect x="14" y="16" width="36" height="30" rx="8" fill="currentColor" />
        <rect x="9" y="26" width="5" height="10" rx="2" fill="currentColor" />
        <rect x="50" y="26" width="5" height="10" rx="2" fill="currentColor" />
        <rect x="21" y="25" width="8" height="7" rx="2" fill="var(--avatar-cut)" />
        <rect x="35" y="25" width="8" height="7" rx="2" fill="var(--avatar-cut)" />
        <rect x="24" y="37" width="16" height="3.5" rx="1.75" fill="var(--avatar-cut)" />
        <rect x="22" y="48" width="20" height="6" rx="3" fill="currentColor" />
      </>
    ),
  },
  ghost: {
    color: 'slate',
    art: (
      <>
        <path
          d="M14 30 Q14 10 32 10 Q50 10 50 30 V54 L44 49 L38 54 L32 49 L26 54 L20 49 L14 54 Z"
          fill="currentColor"
        />
        <ellipse cx="25.5" cy="29" rx="3.2" ry="4.4" fill="var(--avatar-cut)" />
        <ellipse cx="38.5" cy="29" rx="3.2" ry="4.4" fill="var(--avatar-cut)" />
        <ellipse cx="32" cy="39" rx="3" ry="2.4" fill="var(--avatar-cut)" />
      </>
    ),
  },
  blob: {
    color: 'teal',
    art: (
      <>
        <path
          d="M32 10 Q46 10 51 22 Q58 36 48 47 Q38 56 25 52 Q10 48 10 33 Q11 13 32 10 Z"
          fill="currentColor"
        />
        <circle cx="26" cy="29" r="3" fill="var(--avatar-cut)" />
        <circle cx="38" cy="29" r="3" fill="var(--avatar-cut)" />
        <path
          d="M24 38 Q32 45 40 38"
          stroke="var(--avatar-cut)"
          strokeWidth="2.6"
          fill="none"
          strokeLinecap="round"
        />
      </>
    ),
  },
  star: {
    color: 'amber',
    art: (
      <>
        <path
          d="M32 7 L39.2 22.6 L56 24.6 L43.6 36.2 L47 53 L32 44.6 L17 53 L20.4 36.2 L8 24.6 L24.8 22.6 Z"
          fill="currentColor"
          strokeLinejoin="round"
        />
        <circle cx="27.5" cy="31" r="2.2" fill="var(--avatar-cut)" />
        <circle cx="36.5" cy="31" r="2.2" fill="var(--avatar-cut)" />
        <path
          d="M28 37 Q32 40.5 36 37"
          stroke="var(--avatar-cut)"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      </>
    ),
  },
  cube: {
    color: 'violet',
    art: (
      <>
        <path d="M32 10 L52 21 L32 32 L12 21 Z" fill="currentColor" />
        <path d="M12 21 L32 32 V55 L12 44 Z" fill="currentColor" opacity="0.72" />
        <path d="M52 21 L32 32 V55 L52 44 Z" fill="currentColor" opacity="0.45" />
      </>
    ),
  },
  wave: {
    color: 'blue',
    art: (
      <>
        <path
          d="M8 30 Q16 20 24 30 T40 30 T56 30"
          stroke="currentColor"
          strokeWidth="4.5"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M8 42 Q16 32 24 42 T40 42 T56 42"
          stroke="currentColor"
          strokeWidth="4.5"
          fill="none"
          strokeLinecap="round"
          opacity="0.6"
        />
        <circle cx="46" cy="16" r="4" fill="currentColor" />
      </>
    ),
  },
  sun: {
    color: 'orange',
    art: (
      <>
        <circle cx="32" cy="32" r="11" fill="currentColor" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <rect
            key={deg}
            x="30"
            y="8"
            width="4"
            height="9"
            rx="2"
            fill="currentColor"
            transform={`rotate(${deg} 32 32)`}
          />
        ))}
      </>
    ),
  },
  gem: {
    color: 'green',
    art: (
      <>
        <path d="M20 14 H44 L54 26 L32 54 L10 26 Z" fill="currentColor" />
        <path
          d="M10 26 H54 M24 14 L20 26 L32 54 L44 26 L40 14 M20 26 L32 14 L44 26"
          stroke="var(--avatar-cut)"
          strokeWidth="1.8"
          fill="none"
          strokeLinejoin="round"
        />
      </>
    ),
  },
};
