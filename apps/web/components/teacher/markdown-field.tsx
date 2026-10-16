'use client';

import { forwardRef, useState, type TextareaHTMLAttributes } from 'react';
import { useTranslations } from 'next-intl';
import { cn, fieldBaseClass } from '@syntara/ui';
import { SafeMarkdown } from '../markdown/safe-markdown';

/**
 * «Текст урока» (REQ-TCH-TOP-03): Markdown с вкладкой «Просмотр»; рендер — тот же SafeMarkdown, что у ученика.
 * Вкладки — кнопки с aria-pressed: поле ввода остаётся в форме, пока открыт просмотр.
 */
export const MarkdownField = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string; label: string }
>(function MarkdownField({ value, label, id, className, ...props }, ref) {
  const t = useTranslations('teacher.topic');
  const [preview, setPreview] = useState(false);
  const tab = (active: boolean) =>
    cn(
      'min-h-11 rounded-[var(--radius-pill)] px-4 text-sm',
      active ? 'bg-[var(--text)] text-[var(--bg)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]',
    );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm">
          {label}
        </label>
        <div
          role="group"
          className="inline-flex gap-1 rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface)] p-1"
        >
          <button
            type="button"
            aria-pressed={!preview}
            className={tab(!preview)}
            onClick={() => setPreview(false)}
          >
            {t('editTab')}
          </button>
          <button
            type="button"
            aria-pressed={preview}
            className={tab(preview)}
            onClick={() => setPreview(true)}
            data-testid="markdown-preview-tab"
          >
            {t('previewTab')}
          </button>
        </div>
      </div>
      <textarea
        ref={ref}
        id={id}
        value={value}
        hidden={preview}
        aria-describedby={`${id}-hint`}
        className={cn(fieldBaseClass, 'min-h-56 font-mono text-sm leading-6', className)}
        {...props}
      />
      {preview ? (
        <div
          data-testid="markdown-preview"
          className="min-h-56 rounded-[var(--radius-field)] border border-[var(--border)] bg-[var(--field)] p-4"
        >
          {value.trim() ? (
            <SafeMarkdown>{value}</SafeMarkdown>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">{t('emptyPreview')}</p>
          )}
        </div>
      ) : null}
      <p id={`${id}-hint`} className="text-xs text-[var(--text-muted)]">
        {t('markdownHint')}
      </p>
    </div>
  );
});
