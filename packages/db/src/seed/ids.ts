import { v5 as uuidv5 } from 'uuid';

const NAMESPACE = '6f1c2a52-6a0e-4b1f-9a59-3d5b2f0c7e11';

/**
 * Детерминированный UUID для строк seed: повторный запуск seed находит те же строки (идемпотентность).
 * Рабочие данные получают UUIDv7 (5.1); seed-строки — только для разработки и визуальных тестов.
 */
export function seedId(name: string): string {
  return uuidv5(name, NAMESPACE);
}
