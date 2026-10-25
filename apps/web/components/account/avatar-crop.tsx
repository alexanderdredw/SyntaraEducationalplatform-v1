'use client';

import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Modal } from '@syntara/ui';

const VIEW = 256;
const OUTPUT = 512;
const STEP = 8;

interface Frame {
  zoom: number;
  x: number;
  y: number;
}

/**
 * Обрезка картинки-аватара в квадрат (BR-PRF-03): перетаскивание (мышь, палец) или стрелки, масштаб — ползунок.
 * Без библиотек: квадрат рисуется на canvas (512 px, JPEG). Перекодирование и удаление метаданных — на сервере.
 */
export function AvatarCrop({
  file,
  onCancel,
  onApply,
}: {
  file: File | null;
  onCancel: () => void;
  onApply: (blob: Blob) => void;
}) {
  const t = useTranslations('account.profile');
  const tc = useTranslations('common');
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  const [loaded, setLoaded] = useState<{ url: string; w: number; h: number } | null>(null);
  const size = loaded && loaded.url === url ? loaded : null;
  const [frame, setFrame] = useState<Frame>({ zoom: 1, x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);

  const base = size ? VIEW / Math.min(size.w, size.h) : 1;
  const scale = base * frame.zoom;
  /** Картинка всегда закрывает квадрат целиком. */
  const clamp = (f: Frame): Frame => {
    if (!size) return f;
    const s = base * f.zoom;
    const minX = VIEW - size.w * s;
    const minY = VIEW - size.h * s;
    return { zoom: f.zoom, x: Math.min(0, Math.max(minX, f.x)), y: Math.min(0, Math.max(minY, f.y)) };
  };

  const onLoad = () => {
    const img = imgRef.current;
    if (!img || !url) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const s = VIEW / Math.min(w, h);
    setLoaded({ url, w, h });
    setFrame({ zoom: 1, x: (VIEW - w * s) / 2, y: (VIEW - h * s) / 2 });
  };

  const setZoom = (zoom: number) => {
    // Масштаб относительно центра квадрата.
    const center = VIEW / 2;
    const k = zoom / frame.zoom;
    setFrame(clamp({ zoom, x: center - (center - frame.x) * k, y: center - (center - frame.y) * k }));
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: frame.x, y: frame.y };
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    setFrame(clamp({ zoom: frame.zoom, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [STEP, 0],
      ArrowRight: [-STEP, 0],
      ArrowUp: [0, STEP],
      ArrowDown: [0, -STEP],
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    setFrame(clamp({ zoom: frame.zoom, x: frame.x + move[0], y: frame.y + move[1] }));
  };

  const apply = () => {
    const img = imgRef.current;
    if (!img || !size) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const side = VIEW / scale;
    ctx.drawImage(img, -frame.x / scale, -frame.y / scale, side, side, 0, 0, OUTPUT, OUTPUT);
    canvas.toBlob((blob) => blob && onApply(blob), 'image/jpeg', 0.9);
  };

  return (
    <Modal
      open={file !== null}
      onOpenChange={(open) => !open && onCancel()}
      title={t('avatarKinds.photo')}
      description={t('crop')}
      closeLabel={tc('close')}
    >
      <div className="flex flex-col items-center gap-4">
        {/* Перемещение картинки внутри квадрата: мышь, палец или стрелки клавиатуры. */}
        <button
          type="button"
          aria-label={t('crop')}
          data-testid="avatar-crop"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onKeyDown={onKeyDown}
          className="relative cursor-grab touch-none overflow-hidden rounded-full border border-[var(--border-strong)] bg-[var(--field)] active:cursor-grabbing"
          style={{ width: VIEW, height: VIEW }}
        >
          {url ? (
            <img
              ref={imgRef}
              src={url}
              alt=""
              draggable={false}
              onLoad={onLoad}
              className="pointer-events-none absolute top-0 left-0 max-w-none select-none"
              style={
                size
                  ? {
                      width: size.w * scale,
                      height: size.h * scale,
                      transform: `translate(${frame.x}px, ${frame.y}px)`,
                    }
                  : { opacity: 0 }
              }
            />
          ) : null}
        </button>
        <label className="flex w-full max-w-[256px] flex-col gap-1 text-[13px] text-[var(--text-muted)]">
          {t('cropZoom')}
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={frame.zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="accent-[var(--accent)]"
          />
        </label>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onCancel}>
            {t('cropCancel')}
          </Button>
          <Button variant="primary-blue" onClick={apply} disabled={!size} data-testid="avatar-crop-apply">
            {t('cropApply')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
