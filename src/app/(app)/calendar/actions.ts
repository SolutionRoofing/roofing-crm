'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isoDate, isUuid, oneOf, text, uuid } from '@/lib/form';
import { EVENT_TYPES } from '@/lib/options';

const STAFF = ['owner', 'office', 'rep'] as const;

function refresh(jobId: string | null) {
  revalidatePath('/calendar');
  revalidatePath('/dashboard');
  revalidatePath('/pipeline');
  if (jobId) revalidatePath(`/jobs/${jobId}`);
}

/** "who" is "p:<profile id>" for a staff member or "c:<crew id>" for a crew. */
function parseWho(value: string) {
  const [kind, id] = value.split(':');
  if (!id || !isUuid(id)) return { assignee_id: null, crew_id: null };
  return kind === 'c' ? { assignee_id: null, crew_id: id } : { assignee_id: id, crew_id: null };
}

/** Install and Inspection events move the job forward (handled in the database). */
export async function createEvent(fd: FormData) {
  await requireUser([...STAFF]);
  const date = isoDate(fd, 'date');
  if (!date) throw new Error('Pick a date.');
  const type = oneOf(fd, 'type', EVENT_TYPES, 'Other');
  const jobId = uuid(fd, 'job_id');
  const supabase = await createClient();
  const { error } = await supabase.from('events').insert({
    title: text(fd, 'title', 120) || type,
    type, job_id: jobId, date,
    time: text(fd, 'time', 5),
    notes: text(fd, 'notes', 2000),
    ...parseWho(text(fd, 'who', 40)),
  });
  if (error) throw new Error(error.message);
  refresh(jobId);
}

export async function deleteEvent(fd: FormData) {
  await requireUser([...STAFF]);
  const id = uuid(fd, 'id');
  if (!id) return;
  const supabase = await createClient();
  const { error } = await supabase.from('events').delete().eq('id', id);
  if (error) throw new Error(error.message);
  refresh(uuid(fd, 'job_id'));
}

/** New secret for my calendar link; the old link stops working (e.g. a phone was lost). */
export async function resetCalendarLink() {
  await requireUser([...STAFF]);
  const supabase = await createClient();
  const { error } = await supabase.rpc('reset_calendar_token');
  if (error) throw new Error(error.message);
  revalidatePath('/calendar');
}
