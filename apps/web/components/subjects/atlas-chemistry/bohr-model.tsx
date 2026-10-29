'use client';

import { type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { ELECTRON_SHELLS } from '@syntara/shared';

/**
 * Модель Бора (docs/EXPLORE_TZ.md, REQ-EXP-05): SVG по электронной конфигурации — ядро с символом и номером,
 * оболочки с электронами (ELECTRON_SHELLS, логика scripts/content-art/atoms.mjs и квиза T2), подписи «n=1: 2e⁻».
 * Медленное вращение — CSS; в «Экономии трафика» и при reduced motion выключено (atlas.css).
 */
export function BohrModel({
  number,
  symbol,
  name,
  color,
}: {
  number: number;
  symbol: string;
  name: string;
  color: string;
}) {
  const t = useTranslations('atlas.bohr');
  const shells = ELECTRON_SHELLS[number] ?? [];
  const size = 400;
  const c = size / 2;
  const nucleus = 34;
  const step = (c - nucleus - 18) / Math.max(shells.length, 1);
  const label = shells.map((e, i) => t('shell', { n: i + 1, count: e })).join(', ');
  return (
    <figure className="bohr" data-testid="atlas-bohr" data-shells={shells.join(',')}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={t('label', { name, shells: label })}
        className="bohr-svg"
        style={{ '--bohr-color': color } as CSSProperties}
      >
        <defs>
          <radialGradient id={`bohr-n-${number}`} cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor={color} stopOpacity="0.95" />
            <stop offset="100%" stopColor={color} stopOpacity="0.35" />
          </radialGradient>
        </defs>
        {shells.map((electrons, i) => {
          const r = nucleus + step * (i + 1);
          return (
            <g key={i}>
              <circle cx={c} cy={c} r={r} className="bohr-orbit" />
              <g
                className="bohr-ring"
                style={{ animationDuration: `${24 + i * 10}s`, transformOrigin: `${c}px ${c}px` }}
              >
                {Array.from({ length: electrons }, (_, k) => {
                  const a = (2 * Math.PI * k) / electrons - Math.PI / 2 + i * 0.35;
                  return (
                    <circle
                      key={k}
                      cx={c + r * Math.cos(a)}
                      cy={c + r * Math.sin(a)}
                      r={shells.length > 4 ? 4 : 5}
                      className="bohr-electron"
                      data-testid="atlas-bohr-electron"
                    />
                  );
                })}
              </g>
            </g>
          );
        })}
        <circle cx={c} cy={c} r={nucleus} fill={`url(#bohr-n-${number})`} className="bohr-nucleus" />
        <text x={c} y={c + 2} textAnchor="middle" dominantBaseline="middle" className="bohr-symbol">
          {symbol}
        </text>
        <text x={c} y={c + 22} textAnchor="middle" className="bohr-number">
          {number}
        </text>
      </svg>
      <figcaption>
        <ul className="bohr-legend" aria-hidden="true">
          {shells.map((e, i) => (
            <li key={i}>{t('shell', { n: i + 1, count: e })}</li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
