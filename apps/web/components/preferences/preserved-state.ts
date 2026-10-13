'use client';

import { useCallback, useState } from 'react';

/**
 * Состояние, которое переживает смену языка (REQ-GEN-PREF-01, AC-GEN-02).
 * Смена языка — клиентская навигация на другой префикс /{locale}: страница не перезагружается,
 * но поддерево [locale] монтируется заново. Значения хранятся в памяти вкладки (не в localStorage —
 * SM-FORM запрещает сохранять черновики форм в localStorage) и пропадают при перезагрузке.
 */
const store = new Map<string, unknown>();

export function usePreservedState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => (store.has(key) ? (store.get(key) as T) : initial));
  const update = useCallback(
    (next: T) => {
      store.set(key, next);
      setValue(next);
    },
    [key],
  );
  return [value, update];
}
