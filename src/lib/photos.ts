import 'server-only';
import { createClient } from '@/lib/supabase/server';

export type Photo = {
  id: string;
  job_id: string;
  category: string;
  caption: string;
  taken_at: string;
  uploaded_by: string | null;
  uploader: string;
  thumbUrl: string;
  fullUrl: string;
};

/**
 * Photos for the given jobs, with short-lived signed links (the bucket is private).
 * Runs as the signed-in user, so crews only get photos for jobs they hold a work order for.
 */
export async function getPhotos(jobIds: string[]): Promise<Photo[]> {
  if (!jobIds.length) return [];
  const supabase = await createClient();
  const { data: rows } = await supabase.from('photos')
    .select('id, job_id, category, caption, taken_at, uploaded_by, storage_path, thumb_path, profiles(full_name, email)')
    .in('job_id', jobIds)
    .order('taken_at', { ascending: false })
    .limit(500);
  if (!rows?.length) return [];

  const paths = rows.flatMap(r => [r.storage_path, r.thumb_path ?? r.storage_path]);
  const { data: signed } = await supabase.storage.from('job-photos').createSignedUrls([...new Set(paths)], 60 * 60);
  const url = new Map((signed ?? []).filter(s => s.signedUrl).map(s => [s.path, s.signedUrl]));

  return rows.flatMap(r => {
    const fullUrl = url.get(r.storage_path);
    if (!fullUrl) return [];
    const who = r.profiles as unknown as { full_name: string; email: string } | null;
    return [{
      id: r.id, job_id: r.job_id, category: r.category, caption: r.caption, taken_at: r.taken_at, uploaded_by: r.uploaded_by,
      uploader: who?.full_name || who?.email || '',
      fullUrl, thumbUrl: url.get(r.thumb_path ?? r.storage_path) ?? fullUrl,
    }];
  });
}
