'use client';

import { useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { deletePhoto, updatePhoto } from '@/app/(app)/photos/actions';

export type GalleryPhoto = {
  id: string; category: string; caption: string; taken_at: string; uploaded_by: string | null;
  uploader: string; thumbUrl: string; fullUrl: string;
};

function Save({ children, className = 'btn small primary' }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return <button className={className} disabled={pending}>{pending ? '…' : children}</button>;
}

/** Thumbnails, with a full-size viewer for captions and delete. */
export function PhotoGallery({ photos, userId, canEditAll }: { photos: GalleryPhoto[]; userId: string; canEditAll: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const shown = photos;
  const current = open === null ? null : shown[open];

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
      if (e.key === 'ArrowRight') setOpen(i => (i === null ? i : Math.min(shown.length - 1, i + 1)));
      if (e.key === 'ArrowLeft') setOpen(i => (i === null ? i : Math.max(0, i - 1)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, shown.length]);

  if (!photos.length) return <p className="muted">No photos yet.</p>;
  const canEdit = (p: GalleryPhoto) => canEditAll || p.uploaded_by === userId;

  return (
    <>
      <div className="photo-grid">
        {shown.map((p, i) => (
          <button key={p.id} type="button" className="photo-tile" onClick={() => setOpen(i)} aria-label={`Open photo${p.caption ? `: ${p.caption}` : ''}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
            <img src={p.thumbUrl} alt="" loading="lazy" />
          </button>
        ))}
      </div>

      {current && (
        <div className="lightbox-backdrop" role="dialog" aria-modal="true" aria-label="Photo" onClick={e => { if (e.target === e.currentTarget) setOpen(null); }}>
          <div className="lightbox-box">
            <div className="lightbox-top">
              <span className="muted">{open! + 1} of {shown.length} · {new Date(current.taken_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}{current.uploader ? ` · ${current.uploader}` : ''}</span>
              <button type="button" className="icon-btn" onClick={() => setOpen(null)} aria-label="Close">×</button>
            </div>
            <a href={current.fullUrl} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
              <img src={current.fullUrl} alt={current.caption || 'Job photo'} className="lightbox-img" />
            </a>
            <div className="lightbox-nav">
              <button type="button" className="btn small" disabled={open === 0} onClick={() => setOpen(open! - 1)}>‹ Previous</button>
              <button type="button" className="btn small" disabled={open === shown.length - 1} onClick={() => setOpen(open! + 1)}>Next ›</button>
            </div>
            {canEdit(current) ? (
              <form action={updatePhoto} className="inline-form" key={current.id}>
                <input type="hidden" name="id" value={current.id} />
                <input name="caption" defaultValue={current.caption} placeholder="Caption, e.g. Hail hits on north slope" aria-label="Caption" className="grow-input" />
                <Save>Save</Save>
              </form>
            ) : current.caption ? <p>{current.caption}</p> : null}
            {canEdit(current) && (
              <form action={deletePhoto} style={{ marginTop: 8 }}
                onSubmit={e => { if (!window.confirm('Delete this photo? This cannot be undone.')) e.preventDefault(); }}>
                <input type="hidden" name="id" value={current.id} />
                <Save className="btn small danger-ghost">Delete photo</Save>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
