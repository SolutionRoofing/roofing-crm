'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { prepare, queueAll, queueDelete, queuePut, uploadOne } from '@/lib/photo-queue';

export const PHOTO_CATEGORIES = ['Before', 'Damage', 'During', 'After'] as const;

type Item = { id: string; jobId: string; status: 'waiting' | 'uploading' | 'failed'; error?: string; preview?: string };

/** "Add photos" button plus the upload queue for one job. */
export function PhotoUploader({ jobId, userId }: { jobId: string; userId: string }) {
  const router = useRouter();
  const [category, setCategory] = useState<string>('Before');
  const [items, setItems] = useState<Item[]>([]);
  const [preparing, setPreparing] = useState(0);
  const busy = useRef(false);
  const current = useRef<string | null>(null);
  const previews = useRef(new Map<string, string>());

  const sync = useCallback(async () => {
    const all = (await queueAll()).filter(p => p.jobId === jobId);
    setItems(all.map(p => {
      if (!previews.current.has(p.id)) previews.current.set(p.id, URL.createObjectURL(p.thumb));
      const status = current.current === p.id ? 'uploading' : p.error ? 'failed' : 'waiting';
      return { id: p.id, jobId: p.jobId, status, error: p.error, preview: previews.current.get(p.id) };
    }));
    return all;
  }, [jobId]);

  const run = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    let uploaded = 0;
    try {
      for (const p of await sync()) {
        if (!navigator.onLine) break;
        current.current = p.id;
        setItems(list => list.map(i => (i.id === p.id ? { ...i, status: 'uploading', error: undefined } : i)));
        try {
          await uploadOne(p);
          await queueDelete(p.id);
          const url = previews.current.get(p.id);
          if (url) { URL.revokeObjectURL(url); previews.current.delete(p.id); }
          uploaded++;
        } catch (e) {
          await queuePut({ ...p, attempts: p.attempts + 1, error: e instanceof Error ? e.message : 'Upload failed' });
        } finally {
          current.current = null;
        }
      }
    } finally {
      busy.current = false;
      await sync();
      if (uploaded) router.refresh();
    }
  }, [router, sync]);

  // Resume anything left from before (closed page, lost signal) and retry when back online.
  useEffect(() => {
    run();
    const onOnline = () => run();
    window.addEventListener('online', onOnline);
    const timer = setInterval(() => run(), 20000);
    return () => { window.removeEventListener('online', onOnline); clearInterval(timer); };
  }, [run]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files).filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|heic|webp)$/i.test(f.name));
    setPreparing(list.length);
    for (const f of list) {
      try {
        await queuePut(await prepare(f, jobId, userId, category));
      } catch {
        alert(`"${f.name}" could not be read as a photo. Try a JPEG or PNG.`);
      }
      setPreparing(n => n - 1);
    }
    run();
  };

  const failed = items.filter(i => i.status === 'failed');
  return (
    <div className="photo-upload">
      <div className="inline-form">
        <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Photo type">
          {PHOTO_CATEGORIES.map(c => <option key={c}>{c}</option>)}
        </select>
        <label className="btn primary small file-btn">
          Take or add photos
          <input type="file" accept="image/*" multiple hidden onChange={e => { onFiles(e.target.files); e.target.value = ''; }} />
        </label>
        {preparing > 0 && <span className="muted">Preparing {preparing}…</span>}
      </div>
      {items.length > 0 && (
        <div className="upload-queue" role="status">
          <p className="muted">
            {items.some(i => i.status === 'uploading') ? 'Uploading… ' : ''}
            {items.length} waiting to upload{failed.length ? ` · ${failed.length} will retry` : ''}.
            {' '}They&apos;re saved on this device, so they won&apos;t be lost if the signal drops.
          </p>
          <div className="photo-grid">
            {items.map(i => (
              <div key={i.id} className={`photo-tile pending ${i.status}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- local preview blob */}
                {i.preview && <img src={i.preview} alt="Photo waiting to upload" />}
                <span className="photo-tag">{i.status === 'uploading' ? 'Uploading' : i.status === 'failed' ? 'Retrying' : 'Waiting'}</span>
              </div>
            ))}
          </div>
          {failed.length > 0 && <button type="button" className="btn small" onClick={() => run()}>Retry now</button>}
        </div>
      )}
    </div>
  );
}
