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

/** BR-BTL-01: повторы генерации кода при коллизии, затем 503. */
export const BATTLE_CODE_ATTEMPTS = 10;

/**
 * BR-BTL-01, BR-CODE-03: подбор свободного кода — до 10 попыток. Код отбрасывается, если он совпадает с активным
 * кодом класса (`isClassCode` — ClassCodesService.isActiveCode, только чтение) или вставка нарушила уникальность
 * активного кода (`insert` вернул null). Все попытки исчерпаны — null (вызывающий отвечает 503).
 */
export async function allocateBattleCode<T>(
  generate: () => string,
  isClassCode: (code: string) => Promise<boolean>,
  insert: (code: string) => Promise<T | null>,
  attempts = BATTLE_CODE_ATTEMPTS,
): Promise<T | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const code = generate();
    if (await isClassCode(code)) continue;
    const result = await insert(code);
    if (result !== null) return result;
  }
  return null;
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
