'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isoDate, number, oneOf, text, uuid } from '@/lib/form';
import { cleanLines, docTotals, PAYMENT_METHODS } from '@/lib/documents';
import { addDaysISO, todayISO } from '@/lib/format';
import type { FormState } from '@/app/login/actions';

const STAFF = ['owner', 'office', 'rep'] as const;

function refresh(docId: string | null, jobId: string | null) {
  revalidatePath('/money');
  revalidatePath('/pipeline');
  revalidatePath('/dashboard');
  if (docId) revalidatePath(`/documents/${docId}`);
  if (jobId) revalidatePath(`/jobs/${jobId}`);
}

/** Create or update an estimate/invoice from the editor. */
export async function saveDocument(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireUser([...STAFF]);
  const id = uuid(fd, 'id');
  const kind = oneOf(fd, 'kind', ['estimate', 'invoice'] as const, 'estimate');
  const jobId = uuid(fd, 'job_id');
  let items;
  try { items = cleanLines(JSON.parse(text(fd, 'items', 200000) || '[]')); } catch { return { error: 'The line items could not be read.' }; }
  if (!items.length) return { error: 'Add at least one line item.' };
  const taxRate = number(fd, 'tax_rate');
  if (taxRate < 0 || taxRate > 25) return { error: 'Tax rate should be between 0 and 25%.' };
  const fields = {
    items, tax_rate: taxRate, notes: text(fd, 'notes', 4000),
    date: isoDate(fd, 'date') ?? todayISO(),
    due_date: kind === 'invoice' ? isoDate(fd, 'due_date') : null,
  };

  const supabase = await createClient();
  if (id) {
    const { data: existing } = await supabase.from('documents').select('kind, status, job_id, signed_at, payments(amount)').eq('id', id).single();
    if (!existing) return { error: 'That document no longer exists.' };
    if (existing.signed_at) return { error: 'The customer already signed this estimate, so it can no longer be changed. Make a new estimate instead.' };
    if (existing.kind === 'estimate' && ['accepted', 'declined', 'void'].includes(existing.status)) {
      return { error: `This estimate is marked ${existing.status}. Make a new estimate to change the price.` };
    }
    const paid = (existing.payments as { amount: number }[]).reduce((s, p) => s + Number(p.amount), 0);
    if (paid > docTotals(items, taxRate).total) return { error: 'The new total would be less than what has already been paid.' };
    const { error } = await supabase.from('documents').update(fields).eq('id', id);
    if (error) return { error: error.message };
    refresh(id, existing.job_id);
    redirect(`/documents/${id}`);
  }

  if (!jobId) return { error: 'Missing job.' };
  const { data, error } = await supabase.from('documents').insert({ ...fields, kind, job_id: jobId, status: 'draft' }).select('id').single();
  if (error) return { error: error.message };
  await supabase.from('job_activity').insert({ job_id: jobId, kind: 'system', text: `${kind === 'invoice' ? 'Invoice' : 'Estimate'} created` });
  refresh(data.id, jobId);
  redirect(`/documents/${data.id}`);
}

/** Mark sent / accepted (e.g. signed on paper) / declined / void. Triggers move the job forward. */
export async function setDocumentStatus(fd: FormData) {
  await requireUser([...STAFF]);
  const id = uuid(fd, 'id');
  const status = oneOf(fd, 'status', ['draft', 'sent', 'accepted', 'declined', 'void'] as const, 'sent');
  if (!id) return;
  const supabase = await createClient();
  const patch: Record<string, unknown> = { status };
  if (status === 'sent') patch.sent_at = new Date().toISOString();
  const { data, error } = await supabase.from('documents').update(patch).eq('id', id).select('job_id, kind, number').single();
  if (error) throw new Error(error.message);
  await supabase.from('job_activity').insert({
    job_id: data.job_id, kind: 'system',
    text: `${data.kind === 'invoice' ? 'Invoice INV' : 'Estimate EST'}-${String(data.number).padStart(2, '0')} marked ${status}`,
  });
  refresh(id, data.job_id);
}

export async function convertToInvoice(fd: FormData) {
  await requireUser([...STAFF]);
  const id = uuid(fd, 'id');
  if (!id) return;
  const supabase = await createClient();
  const { data: est, error } = await supabase.from('documents').select('job_id, items, tax_rate, notes').eq('id', id).single();
  if (error) throw new Error(error.message);
  const today = todayISO();
  const { data: inv, error: e2 } = await supabase.from('documents').insert({
    kind: 'invoice', job_id: est.job_id, items: est.items, tax_rate: est.tax_rate, notes: est.notes,
    from_id: id, status: 'draft', date: today, due_date: addDaysISO(today, 14),
  }).select('id').single();
  if (e2) throw new Error(e2.message);
  await supabase.from('job_activity').insert({ job_id: est.job_id, kind: 'system', text: 'Invoice created from the estimate' });
  refresh(inv.id, est.job_id);
  redirect(`/documents/${inv.id}`);
}

/** Creates the customer link (and marks a draft as sent). */
export async function shareDocument(fd: FormData) {
  await requireUser([...STAFF]);
  const id = uuid(fd, 'id');
  if (!id) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('share_document', { p_doc: id });
  if (error) throw new Error(error.message);
  const { data } = await supabase.from('documents').select('job_id').eq('id', id).single();
  refresh(id, data?.job_id ?? null);
}

export async function recordPayment(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireUser([...STAFF]);
  const id = uuid(fd, 'document_id');
  const amount = number(fd, 'amount');
  if (!id) return { error: 'Missing invoice.' };
  if (!(amount > 0)) return { error: 'Enter an amount greater than zero.' };
  const supabase = await createClient();
  const { error } = await supabase.from('payments').insert({
    document_id: id, amount: Math.round(amount * 100) / 100,
    date: isoDate(fd, 'date') ?? todayISO(),
    method: oneOf(fd, 'method', PAYMENT_METHODS, 'Check'),
    note: text(fd, 'note', 300),
  });
  if (error) return { error: error.message.includes('balance') ? 'That is more than the balance due.' : error.message };
  const { data } = await supabase.from('documents').select('job_id').eq('id', id).single();
  if (data) await supabase.from('job_activity').insert({ job_id: data.job_id, kind: 'system', text: `Payment of $${amount.toFixed(2)} recorded` });
  refresh(id, data?.job_id ?? null);
  return { ok: 'Payment recorded.' };
}

export async function deletePayment(fd: FormData) {
  await requireUser(['owner', 'office']);
  const id = uuid(fd, 'id');
  const docId = uuid(fd, 'document_id');
  if (!id) return;
  const supabase = await createClient();
  const { error, count } = await supabase.from('payments').delete({ count: 'exact' }).eq('id', id);
  if (error) throw new Error(error.message);
  if (!count) throw new Error('That payment could not be removed.');
  refresh(docId, null);
}

export async function deleteDocument(fd: FormData) {
  await requireUser(['owner', 'office']);
  const id = uuid(fd, 'id');
  if (!id) return;
  const supabase = await createClient();
  const { data } = await supabase.from('documents').select('job_id').eq('id', id).single();
  const { error, count } = await supabase.from('documents').delete({ count: 'exact' }).eq('id', id);
  if (error) throw new Error(error.message);
  if (!count) throw new Error('That document could not be deleted.');
  refresh(null, data?.job_id ?? null);
  redirect(data ? `/jobs/${data.job_id}#money` : '/money');
}

/** Customer signing from the public link. Runs signed-out; the database checks the token. */
export async function signShared(_prev: FormState, fd: FormData): Promise<FormState> {
  const token = text(fd, 'token', 100);
  const name = text(fd, 'name', 120);
  const signature = text(fd, 'signature', 300000) || null;
  if (fd.get('agree') !== 'on') return { error: 'Please tick the box to confirm you accept the estimate.' };
  if (!signature) return { error: 'Please sign in the box with your finger or mouse.' };
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || '';
  const supabase = await createClient();
  const { error } = await supabase.rpc('sign_document', { p_token: token, p_name: name, p_signature: signature, p_ip: ip });
  if (error) return { error: error.message };
  revalidatePath(`/e/${token}`);
  return { ok: 'signed' };
}
