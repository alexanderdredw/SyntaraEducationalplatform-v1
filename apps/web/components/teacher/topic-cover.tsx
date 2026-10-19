'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { COVER_MIME } from '@syntara/shared';
import { Button, cn, fieldClass } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { uploadFile } from '@/lib/upload';
import { useErrorText } from '../forms/form-parts';

export type GalleryItem = components['schemas']['GalleryItemDto'];

/**
 * «Обложка темы» (REQ-TCH-TOP-04): ссылка на изображение или загрузка файла (JPG, PNG, WEBP, GIF до 5 МБ,
 * BR-FILE-01); миниатюры галереи (API-T-18, BR-FILE-05); выбранная — синяя рамка; последнее действие
 * побеждает (PH-26). Миниатюра появляется после проверки файла (BR-FILE-04).
 */
export function CoverPicker({
  coverMediaId,
  coverUrl,
  urlError,
  onSelect,
  onUrl,
}: {
  coverMediaId: string | null;
  coverUrl: string;
  urlError?: string;
  onSelect: (mediaId: string | null) => void;
  onUrl: (url: string) => void;
}) {
  const t = useTranslations('teacher.topic');
  const ts = useTranslations('teacher.topic.scan');
  const errorText = useErrorText();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>();

  const gallery = useQuery({
    queryKey: ['teacher', 'gallery'],
    queryFn: async () => {
      const res = await apiRequest<GalleryItem[]>('/api/teacher/gallery', { locale });
      if (res.kind !== 'ok') throw new Error('gallery');
      return res.data;
    },
    refetchInterval: (q) => (q.state.data?.some((g) => g.scanStatus === 'pending') ? 4000 : false),
  });

  async function upload(file: File) {
    setUploading(true);
    setUploadError(undefined);
    const res = await uploadFile(file, { kind: 'cover' }, locale);
    setUploading(false);
    if (!res.ok) return setUploadError(res.error);
    await queryClient.invalidateQueries({ queryKey: ['teacher', 'gallery'] });
    onSelect(res.media.id);
  }

  const error = errorText(uploadError) ?? urlError;
  return (
    <fieldset className="flex flex-col gap-2" data-testid="topic-cover">
      <legend className="mb-2 text-[13px] text-[var(--text-muted)]">{t('cover')}</legend>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          inputMode="url"
          aria-label={t('coverUrl')}
          placeholder={t('coverUrl')}
          value={coverUrl}
          onChange={(e) => onUrl(e.target.value)}
          aria-invalid={urlError ? true : undefined}
          aria-describedby="cover-hint"
          className={cn(fieldClass, 'sm:flex-1')}
        />
        <Button
          variant="secondary"
          className="sm:min-h-[var(--field-h)]"
          disabled={uploading}
          onClick={() => input.current?.click()}
        >
          {uploading ? t('uploading') : t('upload')}
        </Button>
        <input
          ref={input}
          type="file"
          hidden
          accept={COVER_MIME.join(',')}
          data-testid="cover-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void upload(file);
          }}
        />
      </div>
      {gallery.data?.length ? (
        <ul aria-label={t('gallery')} className="flex flex-wrap gap-3">
          {gallery.data.map((g) => {
            const selected = g.id === coverMediaId;
            return (
              <li key={g.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  aria-label={t('chooseCover', { name: g.name })}
                  onClick={() => onSelect(selected ? null : g.id)}
                  data-testid="gallery-item"
                  className={cn(
                    'flex h-16 w-24 items-center justify-center overflow-hidden rounded-[var(--radius-field)] border-2 bg-[var(--field)] text-xs text-[var(--text-muted)]',
                    selected
                      ? 'border-[var(--accent)]'
                      : 'border-[var(--border)] hover:border-[var(--border-strong)]',
                  )}
                >
                  {g.url ? <img src={g.url} alt="" className="size-full object-cover" /> : ts(g.scanStatus)}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <p id="cover-hint" className="text-xs text-[var(--text-muted)]">
        {t('coverHint')}
      </p>
      {error ? (
        <p role="alert" className="text-xs text-[var(--danger-text)]">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
