'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isUuid, text, uuid } from '@/lib/form';
import { emailConfigured, processOutbox, siteUrl } from '@/lib/email/send';

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

const STAFF = ['owner', 'office', 'rep'] as const;
export type ShareState = { error?: string; ok?: string; link?: string };

/**
 * Makes a customer link for the ticked photos. With send=email it also emails the link
 * from the CRM (through Resend), otherwise it just returns the link to copy.
 */
export async function sharePhotos(_prev: ShareState, fd: FormData): Promise<ShareState> {
  await requireUser([...STAFF]);
  const jobId = uuid(fd, 'job_id');
  if (!jobId) return { error: 'Missing job.' };
  const photoIds = fd.getAll('photo').map(String).filter(isUuid);
  if (!photoIds.length) return { error: 'Tick at least one photo to share.' };
  const message = text(fd, 'message', 1000);
  const byEmail = fd.get('send') === 'email';
  const supabase = await createClient();

  let email = '';
  let contactId: string | null = null;
  if (byEmail) {
    if (!emailConfigured()) return { error: 'Email sending is not connected. Use Copy link instead.' };
    const { data: job } = await supabase.from('jobs').select('contact_id, contacts(email)').eq('id', jobId).single();
    contactId = job?.contact_id ?? null;
    email = (job?.contacts as unknown as { email: string } | null)?.email ?? '';
    if (!contactId || !email) return { error: 'Add an email address to the customer first, or use Copy link.' };
  }

  const { data: token, error } = await supabase.rpc('share_photos', { p_job: jobId, p_photo_ids: photoIds, p_message: message });
  if (error) return { error: error.message };
  const link = `${siteUrl()}/p/${token}`;
  const count = `${photoIds.length} photo${photoIds.length === 1 ? '' : 's'}`;

  if (!byEmail) {
    await supabase.from('job_activity').insert({ job_id: jobId, kind: 'system', text: `Photo link made (${count})` });
    revalidatePath(`/jobs/${jobId}`);
    return { ok: 'Link ready. Copy it into a text or email.', link };
  }

  await supabase.from('photo_shares').update({ sent_to: email }).eq('token', token);
  const body = `Hi {{first_name}},\n\n${message ? `${message}\n\n` : ''}Here are the photos from your project at {{address}}:\n${link}\n\nAny questions, just reply to this email.\n\n{{rep_name}}\n{{company}} | {{company_phone}}`;
  const { error: e2 } = await supabase.from('outbox').insert({
    job_id: jobId, contact_id: contactId, to_email: email,
    subject: 'Photos of your project from {{company}}', body,
    kind: 'followup', send_at: new Date().toISOString(), status: 'scheduled',
  });
  if (e2) return { error: e2.message, link };
  const r = await processOutbox(10);
  await supabase.from('job_activity').insert({ job_id: jobId, kind: 'system', text: `${count} emailed to ${email}` });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath('/emails');
  return { ok: r.sent ? `Sent to ${email}.` : `Queued for ${email}; it will go out within a few minutes.`, link };
}

/** Turns a customer photo link off. */
export async function revokePhotoShare(fd: FormData) {
  await requireUser([...STAFF]);
  const id = uuid(fd, 'id');
  if (!id) return;
  const supabase = await createClient();
  const { data, error } = await supabase.from('photo_shares').update({ revoked_at: new Date().toISOString() }).eq('id', id).select('job_id');
  if (error) throw new Error(error.message);
  if (data?.[0]) revalidatePath(`/jobs/${data[0].job_id}`);
}
