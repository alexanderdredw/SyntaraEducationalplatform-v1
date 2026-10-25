import { fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { AVATAR_ART, Avatar, type AvatarData } from './index';

const base: AvatarData = {
  kind: 'initials',
  preset: null,
  color: 'teal',
  initials: 'АК',
  photoUrl: null,
  photoUrlSmall: null,
};

describe('Avatar (REQ-PRF-11, BR-PRF-02)', () => {
  it('BR-PRF-02 the set has 24 own drawings, each with one of the 8 colours', () => {
    const colors = ['blue', 'violet', 'teal', 'green', 'amber', 'orange', 'pink', 'slate'];
    expect(Object.keys(AVATAR_ART)).toHaveLength(24);
    for (const item of Object.values(AVATAR_ART)) expect(colors).toContain(item.color);
  });

  it('REQ-PRF-11 initials on the chosen colour; the accessible name is the user name; sizes 24…96', () => {
    const { rerender } = render(<Avatar name="Асель Касымова" avatar={base} size={40} />);
    const img = screen.getByRole('img', { name: 'Асель Касымова' });
    expect(img).toHaveTextContent('АК');
    expect(img).toHaveStyle({ width: '40px', height: '40px' });
    expect(img.getAttribute('style')).toContain('--avatar-teal');
    rerender(<Avatar name="Асель Касымова" avatar={base} size={24} />);
    expect(screen.getByRole('img')).toHaveTextContent(/^А$/);
  });

  it('REQ-PRF-11 a preset renders its drawing; decorative avatars are hidden from screen readers', () => {
    const { container, rerender } = render(
      <Avatar name="Ерлан" avatar={{ ...base, kind: 'preset', preset: 'owl' }} />,
    );
    expect(screen.getByRole('img', { name: 'Ерлан' }).querySelector('svg')).not.toBeNull();
    rerender(<Avatar name="Ерлан" avatar={{ ...base, kind: 'preset', preset: 'owl' }} decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
  });

  it('BR-PRF-03 a picture uses the 64 px copy for small sizes; a load error falls back to initials', () => {
    const photo = {
      ...base,
      kind: 'photo' as const,
      photoUrl: 'https://s/256.webp',
      photoUrlSmall: 'https://s/64.webp',
    };
    const { rerender } = render(<Avatar name="Учитель" avatar={photo} size={32} />);
    expect(screen.getByRole('img', { name: 'Учитель' })).toHaveAttribute('src', 'https://s/64.webp');
    rerender(<Avatar name="Учитель" avatar={photo} size={96} />);
    const img = screen.getByRole('img', { name: 'Учитель' });
    expect(img).toHaveAttribute('src', 'https://s/256.webp');
    fireEvent.error(img);
    expect(screen.getByRole('img', { name: 'Учитель' })).toHaveTextContent('АК');
  });

  it('BR-PRF-03 a picture that is not ready (no link) shows initials', () => {
    render(<Avatar name="Учитель" avatar={{ ...base, kind: 'photo' }} />);
    expect(screen.getByRole('img', { name: 'Учитель' })).toHaveTextContent('АК');
  });

  it('AC-PRF-11 no serious axe violations for every avatar kind', async () => {
    const { container } = render(
      <div>
        <Avatar name="А" avatar={base} />
        <Avatar name="Б" avatar={{ ...base, kind: 'preset', preset: 'rocket' }} />
        <Avatar name="В" avatar={{ ...base, kind: 'photo', photoUrl: 'https://s/a.webp' }} />
      </div>,
    );
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });
});
