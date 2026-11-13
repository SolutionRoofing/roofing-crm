'use client';

import { useEffect, useState } from 'react';

export type SharedPhoto = { id: string; caption: string; takenAt: string; full: string; thumb: string; download: string };

/** Thumbnails and a full-size viewer for the customer photo page. */
export function CustomerGallery({ photos }: { photos: SharedPhoto[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const current = open === null ? null : photos[open];

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
      if (e.key === 'ArrowRight') setOpen(i => (i === null ? i : Math.min(photos.length - 1, i + 1)));
      if (e.key === 'ArrowLeft') setOpen(i => (i === null ? i : Math.max(0, i - 1)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, photos.length]);

  return (
    <>
      <div className="photo-grid" style={{ marginTop: 12 }}>
        {photos.map((p, i) => (
          <button key={p.id} type="button" className="photo-tile" onClick={() => setOpen(i)} aria-label={`Open photo ${i + 1}${p.caption ? `: ${p.caption}` : ''}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
            <img src={p.thumb} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      {current && (
        <div className="lightbox-backdrop" role="dialog" aria-modal="true" aria-label="Photo" onClick={e => { if (e.target === e.currentTarget) setOpen(null); }}>
          <div className="lightbox-box">
            <div className="lightbox-top">
              <span className="muted">{open! + 1} of {photos.length} · {new Date(current.takenAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}</span>
              <button type="button" className="icon-btn" onClick={() => setOpen(null)} aria-label="Close">×</button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
            <img src={current.full} alt={current.caption || `Photo ${open! + 1}`} className="lightbox-img" />
            {current.caption && <p style={{ marginTop: 8 }}>{current.caption}</p>}
            <div className="lightbox-nav">
              <button type="button" className="btn small" disabled={open === 0} onClick={() => setOpen(open! - 1)}>‹ Previous</button>
              <a className="btn small" href={current.download}>Download</a>
              <button type="button" className="btn small" disabled={open === photos.length - 1} onClick={() => setOpen(open! + 1)}>Next ›</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
