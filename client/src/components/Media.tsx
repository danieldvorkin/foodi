import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { MediaItem } from '@foodi/shared';
import { errorMessage } from '../api/client';
import { media as mediaApi } from '../api/types';
import { useToast } from './Toast';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm';

interface Pending {
  key: string;
  name: string;
  preview: string;
  progress: number;
  error: string | null;
}

/**
 * Drop zone + picker. Uploads start immediately; each finished file is handed back through
 * onUploaded so the parent can attach it (recipe photos) or collect ids (post attachments).
 */
export function MediaUploader({ recipeId, onUploaded, compact, label = 'Add photos or a short video' }: { recipeId?: string; onUploaded: (m: MediaItem) => void; compact?: boolean; label?: string }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [over, setOver] = useState(false);

  async function handle(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Date.now()}`;
      const preview = URL.createObjectURL(file);
      setPending((p) => [...p, { key, name: file.name, preview, progress: 0, error: null }]);
      try {
        const m = await mediaApi.upload(file, {
          ...(recipeId ? { recipeId } : {}),
          onProgress: (f) => setPending((p) => p.map((x) => (x.key === key ? { ...x, progress: f } : x))),
        });
        setPending((p) => p.filter((x) => x.key !== key));
        onUploaded(m);
      } catch (e) {
        const msg = errorMessage(e);
        setPending((p) => p.map((x) => (x.key === key ? { ...x, error: msg } : x)));
        toast(msg, 'error');
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(preview), 60_000);
      }
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) void handle(e.dataTransfer.files);
  }

  return (
    <div className={`uploader${compact ? ' uploader-compact' : ''}`}>
      <button
        type="button"
        className={`dropzone${over ? ' is-over' : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <span className="dropzone-emoji" aria-hidden="true">
          📷
        </span>
        <span>{label}</span>
        <span className="hint">Drop files here or tap to choose. JPEG, PNG, WebP, GIF, MP4, MOV, WebM.</span>
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void handle(e.target.files);
          e.target.value = '';
        }}
      />
      {pending.length > 0 && (
        <ul className="pending">
          {pending.map((p) => (
            <li key={p.key} className={p.error ? 'is-error' : ''}>
              {p.preview && !p.name.match(/\.(mp4|mov|webm)$/i) ? <img src={p.preview} alt="" /> : <span className="pending-video">🎬</span>}
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </div>
                {p.error ? (
                  <div className="error-text small">{p.error}</div>
                ) : (
                  <div className="bar">
                    <span style={{ width: `${Math.round(p.progress * 100)}%` }} />
                  </div>
                )}
              </div>
              {p.error && (
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => setPending((x) => x.filter((y) => y.key !== p.key))}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MediaThumb({ m, onClick, size = 'md' }: { m: MediaItem; onClick?: () => void; size?: 'sm' | 'md' | 'lg' }) {
  const src = mediaApi.url(m.id);
  const inner =
    m.kind === 'video' ? (
      <video src={src} preload="metadata" muted playsInline />
    ) : (
      <img src={src} alt="" loading="lazy" width={m.width ?? undefined} height={m.height ?? undefined} />
    );
  return onClick ? (
    <button type="button" className={`thumb thumb-${size}`} onClick={onClick} aria-label={m.kind === 'video' ? 'Play video' : 'View photo'}>
      {inner}
      {m.kind === 'video' && <span className="thumb-play">▶</span>}
    </button>
  ) : (
    <div className={`thumb thumb-${size}`}>
      {inner}
      {m.kind === 'video' && <span className="thumb-play">▶</span>}
    </div>
  );
}

/** Photo/video grid with a lightbox. Optional delete for owners. */
export function MediaGallery({ items, onDelete, layout = 'grid' }: { items: MediaItem[]; onDelete?: (m: MediaItem) => void; layout?: 'grid' | 'strip' | 'hero' }) {
  const [open, setOpen] = useState<number | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (open != null && !d.open) d.showModal();
    if (open == null && d.open) d.close();
  }, [open]);
  useEffect(() => {
    if (open == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setOpen((i) => (i == null ? i : (i + 1) % items.length));
      if (e.key === 'ArrowLeft') setOpen((i) => (i == null ? i : (i - 1 + items.length) % items.length));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items.length]);

  if (items.length === 0) return null;
  const current = open != null ? items[open] : null;
  return (
    <>
      <div className={`gallery gallery-${layout} gallery-n${Math.min(items.length, 4)}`}>
        {items.map((m, i) => (
          <div key={m.id} className="gallery-item">
            <MediaThumb m={m} onClick={() => setOpen(i)} size={layout === 'strip' ? 'sm' : 'lg'} />
            {onDelete && (
              <button type="button" className="gallery-del" onClick={() => onDelete(m)} aria-label="Delete">
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      {/* Clicking the <dialog> itself is the backdrop; Escape closes via onClose and arrows are handled above. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <dialog ref={dlg} className="lightbox" onClose={() => setOpen(null)} onClick={(e) => e.target === dlg.current && setOpen(null)}>
        {current && (
          <div className="lightbox-inner">
            {current.kind === 'video' ? <video src={mediaApi.url(current.id)} controls autoPlay playsInline /> : <img src={mediaApi.url(current.id)} alt="" />}
            <div className="lightbox-bar">
              <span className="muted small num">
                {(open ?? 0) + 1} / {items.length}
              </span>
              <div className="row" style={{ gap: 4 }}>
                {items.length > 1 && (
                  <>
                    <button type="button" className="btn btn-sm" onClick={() => setOpen((i) => (i == null ? i : (i - 1 + items.length) % items.length))}>
                      ←
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setOpen((i) => (i == null ? i : (i + 1) % items.length))}>
                      →
                    </button>
                  </>
                )}
                <button type="button" className="btn btn-sm" onClick={() => setOpen(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
