// Browser-side photo upload queue.
// Photos are shrunk on the phone, saved in the phone's own storage (IndexedDB) first,
// then uploaded. If the signal drops, they stay queued and retry automatically,
// even after the page is closed and reopened.
import { createClient } from '@/lib/supabase/browser';

export type Pending = {
  id: string;
  jobId: string;
  userId: string;
  /** Only on photos queued before photo types were removed; ignored. */
  category?: string;
  full: Blob;
  thumb: Blob;
  takenAt: string;
  attempts: number;
  error?: string;
};

const DB_NAME = 'crm-photo-queue';
const STORE = 'pending';
export const BUCKET = 'job-photos';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export const queueAll = () => withStore<Pending[]>('readonly', s => s.getAll());
export const queuePut = (p: Pending) => withStore('readwrite', s => s.put(p));
export const queueDelete = (id: string) => withStore('readwrite', s => s.delete(id));

/** Shrinks a photo to fit within maxSide pixels, as JPEG. Respects the phone's rotation. */
export async function shrink(file: Blob, maxSide: number, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not process the photo'))), 'image/jpeg', quality));
}

export async function prepare(file: File, jobId: string, userId: string): Promise<Pending> {
  const [full, thumb] = await Promise.all([shrink(file, 1600, 0.82), shrink(file, 400, 0.7)]);
  return {
    id: crypto.randomUUID(), jobId, userId, full, thumb,
    takenAt: new Date(file.lastModified || Date.now()).toISOString(), attempts: 0,
  };
}

/** Uploads one queued photo. Safe to repeat: files overwrite and a duplicate row counts as done. */
export async function uploadOne(p: Pending): Promise<void> {
  const supabase = createClient();
  const fullPath = `${p.jobId}/${p.id}.jpg`;
  const thumbPath = `${p.jobId}/${p.id}_t.jpg`;
  const opts = { contentType: 'image/jpeg', upsert: true };
  const a = await supabase.storage.from(BUCKET).upload(fullPath, p.full, opts);
  if (a.error) throw new Error(a.error.message);
  const b = await supabase.storage.from(BUCKET).upload(thumbPath, p.thumb, opts);
  if (b.error) throw new Error(b.error.message);
  const { error } = await supabase.from('photos').insert({
    id: p.id, job_id: p.jobId, storage_path: fullPath, thumb_path: thumbPath,
    uploaded_by: p.userId, taken_at: p.takenAt,
  });
  if (error && error.code !== '23505') throw new Error(error.message);
}
