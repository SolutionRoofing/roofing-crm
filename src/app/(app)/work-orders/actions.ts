'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

const STATUSES = ['assigned', 'in_progress', 'done'];

// Runs as the signed-in user: the database only lets a crew touch its own work orders,
// and only their status and notes.
export async function updateWorkOrder(formData: FormData) {
  await requireUser();
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  const notes = formData.get('crew_notes');
  if (!id || !STATUSES.includes(status)) return;

  const supabase = await createClient();
  const patch: { status: string; crew_notes?: string } = { status };
  if (typeof notes === 'string') patch.crew_notes = notes.slice(0, 4000);
  const { error } = await supabase.from('work_orders').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/work-orders');
}
