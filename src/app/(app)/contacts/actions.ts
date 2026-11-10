'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { checked, oneOf, text, uuid } from '@/lib/form';
import { LEAD_SOURCES } from '@/lib/options';

const STAFF = ['owner', 'office', 'rep'] as const;

function fields(fd: FormData) {
  const marketing = checked(fd, 'marketing');
  return {
    first: text(fd, 'first', 80), last: text(fd, 'last', 80),
    phone: text(fd, 'phone', 40), email: text(fd, 'email', 200).toLowerCase(),
    address: text(fd, 'address', 200), city: text(fd, 'city', 80), st: text(fd, 'st', 2).toUpperCase(), zip: text(fd, 'zip', 10),
    source: oneOf(fd, 'source', LEAD_SOURCES, 'Other'), tags: text(fd, 'tags', 200), notes: text(fd, 'notes', 4000),
    marketing,
    // Re-opting in clears an earlier unsubscribe (undefined leaves the column untouched).
    unsubscribed_at: marketing ? null : undefined,
  };
}

export async function updateContact(fd: FormData) {
  await requireUser([...STAFF]);
  const id = uuid(fd, 'id');
  if (!id) return;
  const supabase = await createClient();
  const { error } = await supabase.from('contacts').update(fields(fd)).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/contacts');
  revalidatePath(`/contacts/${id}`);
  revalidatePath('/jobs');
  revalidatePath('/pipeline');
}

export async function createContact(fd: FormData) {
  await requireUser([...STAFF]);
  const f = fields(fd);
  if (!f.first && !f.last) throw new Error('Enter a name.');
  const supabase = await createClient();
  const { data, error } = await supabase.from('contacts').insert({ ...f, unsubscribed_at: null }).select('id').single();
  if (error) throw new Error(error.message);
  revalidatePath('/contacts');
  redirect(`/contacts/${data.id}`);
}

export async function deleteContact(fd: FormData) {
  await requireUser(['owner', 'office']);
  const id = uuid(fd, 'id');
  if (!id) return;
  const supabase = await createClient();
  const { error, count } = await supabase.from('contacts').delete({ count: 'exact' }).eq('id', id);
  if (error) throw new Error(error.message);
  if (!count) throw new Error('That customer could not be deleted.');
  revalidatePath('/contacts');
  redirect('/contacts');
}
