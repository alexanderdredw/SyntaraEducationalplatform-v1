'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { COVER_MIME } from '@syntara/shared';
import { Button, cn, fieldClass } from '@syntara/ui';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { uploadFile } from '@/lib/upload';
import { X } from 'lucide-react';
import { useErrorText } from '../forms/form-parts';
import { ConfirmDelete } from './confirm-delete';

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
  const td = useTranslations('teacher.delete');
  const [deleting, setDeleting] = useState<GalleryItem | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  /** API-T-31: удаление картинки из галереи; выбранная в форме — снимается с темы (иначе сохранение не пройдёт). */
  async function removeImage() {
    if (!deleting) return;
    setDeletePending(true);
    setDeleteError(null);
    const res = await apiRequest(`/api/teacher/gallery/${deleting.id}`, { method: 'DELETE' });
    setDeletePending(false);
    if (res.kind !== 'ok') {
      const key = res.kind === 'http' ? res.error.fieldErrors?.media : undefined;
      // Где используется — по свежему списку галереи (обложку могли выбрать в другой вкладке).
      const fresh = (await gallery.refetch()).data?.find((g) => g.id === deleting.id);
      const title = fresh?.usedIn?.title ?? deleting.usedIn?.title ?? '';
      return setDeleteError(
        key === 'coverInUse' || key === 'coverInUseBattle' ? td(key, { title }) : td('failed'),
      );
    }
    if (deleting.id === coverMediaId) onSelect(null);
    setDeleting(null);
    await queryClient.invalidateQueries({ queryKey: ['teacher', 'gallery'] });
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
      {coverMediaId || coverUrl ? (
        // DELETE_TZ, раздел 3, п. 4: тема без обложки.
        <div>
          <Button
            variant="text"
            data-testid="remove-cover"
            onClick={() => {
              onSelect(null);
              onUrl('');
            }}
          >
            {td('removeCover')}
          </Button>
        </div>
      ) : null}
      {gallery.data?.length ? (
        <ul aria-label={t('gallery')} className="flex flex-wrap gap-3">
          {gallery.data.map((g) => {
            const selected = g.id === coverMediaId;
            // BR-DEL-04: используемую картинку удалить нельзя — «✕» неактивна, с подсказкой где используется.
            const usedHint = g.usedIn
              ? td(g.usedIn.kind === 'battle' ? 'usedInBattle' : 'usedInTopic', { title: g.usedIn.title })
              : null;
            return (
              <li key={g.id} className="group relative">
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
                <button
                  type="button"
                  data-testid="gallery-delete"
                  aria-label={td('imageAria')}
                  aria-disabled={usedHint ? true : undefined}
                  aria-describedby={usedHint ? `gallery-used-${g.id}` : undefined}
                  title={usedHint ? undefined : td('imageAria')}
                  onClick={() => {
                    if (usedHint) return;
                    setDeleteError(null);
                    setDeleting(g);
                  }}
                  className={cn(
                    // Телефон — видна всегда; компьютер — при наведении и при фокусе с клавиатуры.
                    'absolute -top-2 -right-2 inline-flex size-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] shadow-card after:absolute after:-inset-1.5 after:content-[""] md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:group-focus-within:opacity-100',
                    usedHint
                      ? 'peer cursor-not-allowed border-dashed text-[var(--text-muted)] opacity-70'
                      : 'text-[var(--text)] hover:text-[var(--danger-text)]',
                  )}
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
                {usedHint ? (
                  // Подсказка видна при наведении и фокусе на «✕» (на телефоне — по нажатию, фокус остаётся на кнопке).
                  <span
                    id={`gallery-used-${g.id}`}
                    role="tooltip"
                    data-testid="gallery-used-hint"
                    className="pointer-events-none invisible absolute top-full left-0 z-10 mt-2 w-max max-w-[240px] rounded-[var(--radius-field)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] shadow-popover peer-hover:visible peer-focus-visible:visible peer-focus:visible"
                  >
                    {usedHint}
                  </span>
                ) : null}
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
      <ConfirmDelete
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={td('imageConfirmTitle')}
        pending={deletePending}
        error={deleteError}
        onConfirm={() => void removeImage()}
      />
    </fieldset>
  );
}
