import { randomInt } from 'node:crypto';

/**
 * BR-BTL-01: код сессии — 3 буквы и 3 цифры (PH-45 `battle.code`, по умолчанию A–Z и 1–9; формат закреплён
 * CHECK в 5.9). Генерация криптостойкая; уникальность среди активных сессий — частичный индекс ux_battle_active_code.
 */
export function generateBattleCode(
  alphabet: { letters: string; digits: string } = {
    letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    digits: '123456789',
  },
): string {
  const pick = (chars: string) => chars[randomInt(chars.length)]!;
  return (
    [0, 1, 2].map(() => pick(alphabet.letters)).join('') + [0, 1, 2].map(() => pick(alphabet.digits)).join('')
  );
}

/** Перемешивание (Фишер — Йетс, crypto.randomInt) — один порядок для всех участников сессии. */
export function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}
