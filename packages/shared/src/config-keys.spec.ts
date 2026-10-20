import { describe, expect, it } from 'vitest';
import { CONFIG_KEYS } from './config-keys';

describe('CONFIG_KEYS (раздел 11)', () => {
  it('AG-02 covers every placeholder PH-01..PH-45', () => {
    const phs = new Set(Object.values(CONFIG_KEYS).map((m) => m.ph));
    for (let n = 1; n <= 45; n++) expect(phs, `PH-${n}`).toContain(`PH-${String(n).padStart(2, '0')}`);
  });

  it('AG-10 marks PH-09 and PH-14 as production-blocking', () => {
    const blocked = Object.entries(CONFIG_KEYS)
      .filter(([, m]) => 'prodBlocked' in m && m.prodBlocked)
      .map(([k]) => k);
    expect(blocked.sort()).toEqual(['legal.draft_banner', 'support.email']);
  });
});
