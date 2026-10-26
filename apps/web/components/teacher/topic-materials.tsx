'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { FileText, X } from 'lucide-react';
import { MATERIAL_TYPES } from '@syntara/shared';
import { Button } from '@syntara/ui';
import type { components } from '@/lib/api/schema';
import { uploadFile } from '@/lib/upload';
import { useErrorText } from '../forms/form-parts';
import { StatusPill } from './parts';

export type Material = components['schemas']['MaterialDto'];

const ACCEPT = Object.keys(MATERIAL_TYPES)
  .map((ext) => `.${ext}`)
  .join(',');

/**
 * «Материалы урока» (REQ-TCH-TOP-05): PDF, DOCX, PPTX, ODT, TXT до 25 МБ, до 20 файлов и 200 МБ на тему
 * (BR-FILE-02); таблицы не принимаются (BR-FILE-09) — в окне выбора их нет, выбранная сразу получает ошибку.
 * Статус проверки «Проверяется / Готов / Отклонён» (SM-FILE, BR-FILE-03); таблица, загруженная до запрета, —
 * «Формат больше не поддерживается» (ученикам не выдаётся), её можно убрать «✕».
 * Порядок и состав сохраняются кнопкой «Сохранить» (API-T-10).
 */
export function MaterialsList({
  topicId,
  materials,
  onChange,
  error,
}: {
  topicId: string;
  materials: Material[];
  onChange: (next: Material[]) => void;
  error?: string;
}) {
  const t = useTranslations('teacher.topic');
  const ts = useTranslations('teacher.topic.scan');
  const errorText = useErrorText();
  const locale = useLocale();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [failures, setFailures] = useState<Array<{ name: string; error: string }>>([]);
  const size = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  async function upload(files: File[]) {
    setUploading(true);
    setFailures([]);
    let list = materials;
    const failed: Array<{ name: string; error: string }> = [];
    // По одному: лимит на тему проверяется сервером для каждого файла (AC-TCH-06).
    for (const file of files) {
      const res = await uploadFile(file, { kind: 'material', topicId }, locale);
      if (res.ok) {
        list = [
          ...list,
          {
            id: res.media.id,
            name: file.name,
            mime: file.type,
            size: file.size,
            scanStatus: res.media.scanStatus,
            url: res.media.url,
            formatNotSupported: false,
          },
        ];
        onChange(list);
      } else failed.push({ name: file.name, error: res.error });
    }
    setFailures(failed);
    setUploading(false);
  }

  return (
    <fieldset className="flex flex-col gap-2" data-testid="topic-materials">
      <legend className="mb-2 text-[13px] text-[var(--text-muted)]">{t('materials')}</legend>
      <div>
        <Button variant="secondary" disabled={uploading} onClick={() => input.current?.click()}>
          {uploading ? t('uploading') : t('addFile')}
        </Button>
        <input
          ref={input}
          type="file"
          hidden
          multiple
          accept={ACCEPT}
          data-testid="material-file"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) void upload(files);
          }}
        />
      </div>
      {materials.length ? (
        <ul className="flex flex-col gap-2">
          {materials.map((m) => (
            <li
              key={m.id}
              data-testid="material"
              data-status={m.scanStatus}
              className="flex flex-col gap-1 rounded-[var(--radius-field)] border border-[var(--border)] px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-3">
                <FileText aria-hidden="true" className="size-4 shrink-0 text-[var(--accent)]" />
                {m.url ? (
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate hover:underline"
                  >
                    {m.name}
                  </a>
                ) : (
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                )}
                <span className="text-xs text-[var(--text-muted)]">
                  {m.size < 1_048_576
                    ? t('fileSizeKb', { size: size.format(Math.max(m.size / 1024, 0.1)) })
                    : t('fileSize', { size: size.format(m.size / 1_048_576) })}
                </span>
                <StatusPill
                  tone={
                    m.scanStatus === 'clean' ? 'success' : m.scanStatus === 'rejected' ? 'danger' : 'neutral'
                  }
                >
                  {ts(m.scanStatus)}
                </StatusPill>
                <button
                  type="button"
                  aria-label={t('removeFile', { name: m.name })}
                  onClick={() => onChange(materials.filter((x) => x.id !== m.id))}
                  className="inline-flex size-11 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--field)] hover:text-[var(--text)]"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </div>
              {m.scanStatus === 'rejected' ? (
                <p className="text-xs text-[var(--danger-text)]">{t('rejected')}</p>
              ) : null}
              {m.formatNotSupported ? (
                <p className="text-xs text-[var(--danger-text)]" data-testid="material-not-supported">
                  {t('formatNotSupported')}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-[var(--text-muted)]">{t('materialsHint')}</p>
      {failures.length || error ? (
        <ul
          role="alert"
          className="flex flex-col gap-1 text-xs text-[var(--danger-text)]"
          data-testid="material-errors"
        >
          {failures.map((f) => (
            <li key={f.name}>
              {f.name}: {errorText(f.error)}
            </li>
          ))}
          {error ? <li>{error}</li> : null}
        </ul>
      ) : null}
    </fieldset>
  );
}
