'use client';

import { type RefObject, useEffect, useState } from 'react';

/** Телефон (REQ-GEN-SHELL-04): плавающие кнопки не должны закрывать поля ввода и текст. */
const PHONE = '(max-width: 768px)';

/** Поля, при фокусе на которых открывается экранная клавиатура. */
const TEXT_ENTRY =
  'input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"], [type="range"], [type="file"], [type="color"]), textarea, select, [contenteditable="true"]';

/** Элементы управления и карточки с пометкой `data-floating-solid` — по их прямоугольнику. */
const CONTROLS =
  'input, textarea, select, button, img, svg, video, canvas, [role="tab"], [role="img"], [data-floating-solid]';
/** Текст — по прямоугольнику самого текста (у абзаца на всю ширину правый край часто пуст). */
const TEXT = 'p, h1, h2, h3, h4, h5, h6, label, li, a, dt, dd, td, th, summary, blockquote, figcaption, span';

/** Отступ вокруг кнопок, px. */
const GAP = 4;

type Box = { left: number; right: number; top: number; bottom: number };
const overlap = (a: Box, b: Box) =>
  a.left < b.right + GAP && a.right > b.left - GAP && a.top < b.bottom + GAP && a.bottom > b.top - GAP;

function contentUnder(zone: Box, frame: Element): boolean {
  const range = document.createRange();
  const roots = document.querySelectorAll('#main, footer');
  for (const root of roots) {
    for (const el of root.querySelectorAll(`${CONTROLS}, ${TEXT}`)) {
      // Декор (фон с линиями, иконки) и скрытые подписи (sr-only) не считаются.
      if (frame.contains(el) || el.closest('[aria-hidden="true"]')) continue;
      const box = el.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1 || !overlap(box, zone)) continue;
      if (el.matches(CONTROLS)) return true;
      // Только видимый текст элемента: прямоугольники строк, а не всего блока.
      range.selectNodeContents(el);
      for (const line of range.getClientRects()) {
        if (line.width > 1 && line.height > 1 && overlap(line, zone)) return true;
      }
    }
  }
  return false;
}

/**
 * REQ-GEN-SHELL-04 на телефоне: плавающие кнопки убираются, пока в фокусе поле ввода (открыта клавиатура) и пока под
 * ними оказываются поля, кнопки или текст страницы; открытая справка «?» не убирается. Проверка — при прокрутке,
 * изменении размера и содержимого (раз в кадр). На широком экране кнопки видны всегда.
 */
export function useFloatingClearance(ref: RefObject<HTMLElement | null>): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const phone = window.matchMedia(PHONE);
    let typing = false;
    let frame = 0;

    const check = () => {
      frame = 0;
      const el = ref.current;
      if (!el || !phone.matches) return setHidden(false);
      if (typing) return setHidden(true);
      if (el.querySelector('[data-state="open"]')) return setHidden(false);
      setHidden(contentUnder(el.getBoundingClientRect(), el));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target;
      typing = target instanceof Element && target.matches(TEXT_ENTRY) && !ref.current?.contains(target);
      schedule();
    };
    const onFocusOut = () => {
      typing = false;
      schedule();
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state', 'class', 'hidden', 'open'],
    });
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    phone.addEventListener('change', schedule);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    schedule();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      phone.removeEventListener('change', schedule);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, [ref]);

  return hidden;
}
