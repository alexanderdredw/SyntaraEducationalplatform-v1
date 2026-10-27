'use client';

import { type RefObject, useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Окна атласа (панель фильтра, окна элемента и учёного) — доступность без изменения вида (REQ-ATL-06.4): фокус
 * на окно при открытии (без видимой рамки; Tab — к первой кнопке), Tab не уходит за окно, Esc закрывает, после закрытия фокус возвращается; прокрутка страницы
 * под окном выключена (как в оригинале: body overflow hidden).
 */
export function useDialog(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () => [...(node?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (node && !node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
    node?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close.current();
      } else if (e.key === 'Tab') {
        const list = focusables();
        if (list.length === 0) return;
        const first = list[0]!;
        const last = list.at(-1)!;
        if (document.activeElement === node) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [ref]);
}
