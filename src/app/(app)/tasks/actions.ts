'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { checked, isoDate, text, uuid } from '@/lib/form';

const STAFF = ['owner', 'office', 'rep'] as const;

function refresh(jobId: string | null) {
  revalidatePath('/tasks');
  revalidatePath('/dashboard');
  if (jobId) revalidatePath(`/jobs/${jobId}`);
}

export async function createTask(fd: FormData) {
  const me = await requireUser([...STAFF]);
  const title = text(fd, 'title', 200);
  if (!title) return;
  const jobId = uuid(fd, 'job_id');
  const supabase = await createClient();
  const assignee = fd.has('assignee_id') ? uuid(fd, 'assignee_id') : me.id;
  const { error } = await supabase.from('tasks').insert({ title, job_id: jobId, assignee_id: assignee, due: isoDate(fd, 'due') });
  if (error) throw new Error(error.message);
  refresh(jobId);
}

export async function toggleTask(fd: FormData) {
  await requireUser([...STAFF]);
  const id = uuid(fd, 'id');
  if (!id) return;
  const supabase = await createClient();
  const { error } = await supabase.from('tasks').update({ done: checked(fd, 'done') }).eq('id', id);
  if (error) throw new Error(error.message);
  refresh(uuid(fd, 'job_id'));
}

export async function deleteTask(fd: FormData) {
  await requireUser([...STAFF]);
  const id = uuid(fd, 'id');
  if (!id) return;
  const supabase = await createClient();
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) throw new Error(error.message);
  refresh(uuid(fd, 'job_id'));
}
