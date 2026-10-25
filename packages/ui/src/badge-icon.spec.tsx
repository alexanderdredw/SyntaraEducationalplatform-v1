import { render } from '@testing-library/react';
import { BADGE_LOOK, BadgeIcon } from './index';

describe('BadgeIcon (FIX-05, BR-BDG-01)', () => {
  it('AC-PRF-20 each of the 12 badges has its own icon; earned — coloured, locked — grey', () => {
    expect(Object.keys(BADGE_LOOK)).toHaveLength(12);
    expect(new Set(Object.values(BADGE_LOOK).map((l) => l.icon)).size).toBe(12);
    const { container, rerender } = render(<BadgeIcon code="warmup" />);
    const earned = container.querySelector('[data-badge-icon="warmup"]')!;
    expect(earned.getAttribute('style')).toContain('--avatar-orange');
    expect(earned).toHaveAttribute('aria-hidden', 'true');
    rerender(<BadgeIcon code="warmup" earned={false} />);
    const locked = container.querySelector('[data-badge-icon="warmup"]')!;
    expect(locked.getAttribute('style') ?? '').not.toContain('--avatar-');
    expect(locked.className).toContain('text-[var(--text-muted)]');
    rerender(<BadgeIcon code="first_step" imageUrl="https://s/medal.png" />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://s/medal.png');
  });
});
