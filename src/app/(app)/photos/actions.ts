'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { text, uuid } from '@/lib/form';

function refresh(jobId: string | null) {
  revalidatePath('/work-orders');
  if (jobId) revalidatePath(`/jobs/${jobId}`);
}

/** Caption. The database decides who may edit (staff: any; crews: their own uploads). */
export async function updatePhoto(fd: FormData) {
  await requireUser();
  const id = uuid(fd, 'id');
  if (!id) return;
  const supabase = await createClient();
  const { data, error } = await supabase.from('photos')
    .update({ caption: text(fd, 'caption', 300) })
    .eq('id', id).select('job_id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('You can only edit photos you uploaded.');
  refresh(data[0].job_id);
}

export async function deletePhoto(fd: FormData) {
  await requireUser();
  const id = uuid(fd, 'id');
  if (!id) return;
  const supabase = await createClient();
  const { data, error } = await supabase.from('photos').delete().eq('id', id).select('job_id, storage_path, thumb_path');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('You can only delete photos you uploaded.');
  const files = [data[0].storage_path, data[0].thumb_path].filter(Boolean) as string[];
  await supabase.storage.from('job-photos').remove(files);
  refresh(data[0].job_id);
}
