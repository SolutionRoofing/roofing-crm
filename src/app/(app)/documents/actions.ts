'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isAdmin, requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isoDate, number, oneOf, text, uuid } from '@/lib/form';
import {
  cleanLines, cleanOptions, cleanSelections, cleanUpgrades, docTotals, isItem, PAYMENT_METHODS, type EstOption, type Line,
} from '@/lib/documents';
import { addDaysISO, todayISO } from '@/lib/format';
import type { FormState } from '@/app/login/actions';
import { emailConfigured, processOutbox, siteUrl } from '@/lib/email/send';

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
  const me = await requireUser([...STAFF]);
  const id = uuid(fd, 'id');
  const kind = oneOf(fd, 'kind', ['estimate', 'invoice'] as const, 'estimate');
  const jobId = uuid(fd, 'job_id');
  let items: Line[];
  let options: EstOption[] = [];
  const json = (k: string) => JSON.parse(text(fd, k, 600000) || '[]');
  try {
    items = cleanLines(json('items'));
    if (kind === 'estimate') options = cleanOptions(json('options'));
  } catch { return { error: 'The line items could not be read.' }; }
  if (options.length === 1) options = [];
  if (options.length) {
    const empty = options.find(o => !o.items.some(isItem));
    if (empty) return { error: `The "${empty.name}" option has no line items. Add some or remove the option.` };
    items = options[0].items;
  }
  if (!items.some(isItem)) return { error: 'Add at least one line item.' };
  let upgrades: ReturnType<typeof cleanUpgrades> = [];
  let selections: ReturnType<typeof cleanSelections> = [];
  try {
    upgrades = kind === 'estimate' ? cleanUpgrades(JSON.parse(text(fd, 'upgrades', 50000) || '[]')) : [];
    selections = kind === 'estimate' ? cleanSelections(JSON.parse(text(fd, 'selections', 20000) || '[]')) : [];
  } catch { return { error: 'The upgrades or selections could not be read.' }; }
  const taxRate = number(fd, 'tax_rate');
  if (taxRate < 0 || taxRate > 25) return { error: 'Sales tax should be between 0 and 25%.' };
  const materialTax = number(fd, 'material_tax_rate');
  if (materialTax < 0 || materialTax > 25) return { error: 'Material tax should be between 0 and 25%.' };

  const supabase = await createClient();
  // New products picked in any option go to the price list once.
  if (options.length) {
    options = await Promise.all(options.map(async o => ({ ...o, items: await saveNewProducts(supabase, o.items, isAdmin(me)) })));
    items = options[0].items;
  } else {
    items = await saveNewProducts(supabase, items, isAdmin(me));
  }
  const fields = {
    items, options, upgrades, selections, tax_rate: taxRate, material_tax_rate: materialTax, notes: text(fd, 'notes', 4000), internal_notes: text(fd, 'internal_notes', 4000),
    date: isoDate(fd, 'date') ?? todayISO(),
    due_date: kind === 'invoice' ? isoDate(fd, 'due_date') : null,
  };

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

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * Lines picked as "Add new product" go into the price list (owner/office only, like JobNimbus
 * Products & Services). Everyone else's new lines simply stay one-off lines on this estimate.
 */
async function saveNewProducts(supabase: Db, items: Line[], admin: boolean): Promise<Line[]> {
  const fresh = items.filter(l => isItem(l) && l.save);
  if (!admin || !fresh.length) return items.map(l => (isItem(l) && l.save ? { ...l, save: undefined } : l)).map(strip);
  const out: Line[] = [];
  for (const l of items) {
    if (!isItem(l) || !l.save) { out.push(strip(l)); continue; }
    const { data } = await supabase.from('catalog_items').insert({
      name: l.name, description: l.desc, unit: l.unit || 'EA', price: l.price,
      material_cost: l.mat, labor_cost: l.lab, markup: l.markup, sort: 1000,
    }).select('id').single();
    out.push(strip({ ...l, ...(data ? { pid: data.id } : {}) }));
  }
  return out;
}
const strip = (l: Line): Line => {
  if (!isItem(l)) return l;
  const { save: _save, ...rest } = l; // eslint-disable-line @typescript-eslint/no-unused-vars -- drop the editor-only flag
  return rest;
};

/** "Save as template" from the editor: keeps the lines and customer note under a name. */
export async function saveEstimateTemplate(name: string, payload: {
  items: unknown; notes: unknown; options?: unknown; upgrades?: unknown; selections?: unknown;
}): Promise<FormState> {
  await requireUser([...STAFF]);
  const clean = String(name ?? '').trim().slice(0, 120);
  if (!clean) return { error: 'Give the template a name.' };
  let options = cleanOptions(payload?.options).map(o => ({ ...o, items: o.items.map(strip) }));
  if (options.length === 1) options = [];
  const items = (options.length ? options[0].items : cleanLines(payload?.items)).map(strip);
  if (!items.some(isItem)) return { error: 'Add at least one line item first.' };
  const supabase = await createClient();
  const { error } = await supabase.from('estimate_templates').insert({
    name: clean, items, options, upgrades: cleanUpgrades(payload?.upgrades), selections: cleanSelections(payload?.selections),
    notes: String(payload?.notes ?? '').slice(0, 4000),
  });
  if (error) return { error: error.message };
  revalidatePath('/documents/new');
  revalidatePath('/settings');
  return { ok: `Saved as "${clean}".` };
}

export async function deleteEstimateTemplate(fd: FormData) {
  await requireUser([...STAFF]);
  const id = uuid(fd, 'id');
  if (!id) return;
  const supabase = await createClient();
  const { error } = await supabase.from('estimate_templates').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/settings');
}

/** Copy an estimate as a new draft (same lines, costs and notes) and open it for editing. */
export async function duplicateDocument(fd: FormData) {
  await requireUser([...STAFF]);
  const id = uuid(fd, 'id');
  if (!id) return;
  const supabase = await createClient();
  const { data: d, error } = await supabase.from('documents')
    .select('kind, job_id, items, options, upgrades, selections, signed_at, tax_rate, material_tax_rate, notes, internal_notes').eq('id', id).single();
  if (error) throw new Error(error.message);
  const today = todayISO();
  const { data: copy, error: e2 } = await supabase.from('documents').insert({
    // A signed estimate's items are the customer's pick; copy that, not the original choices.
    kind: d.kind, job_id: d.job_id, items: d.items, tax_rate: d.tax_rate, material_tax_rate: d.material_tax_rate,
    options: d.signed_at ? [] : d.options, upgrades: d.signed_at ? [] : d.upgrades,
    selections: (d.selections as { label: string }[]).map(q => ({ label: q.label, value: d.signed_at ? (q as { value?: string }).value ?? '' : '' })),
    notes: d.notes, internal_notes: d.internal_notes, status: 'draft', date: today,
    due_date: d.kind === 'invoice' ? addDaysISO(today, 14) : null,
  }).select('id').single();
  if (e2) throw new Error(e2.message);
  await supabase.from('job_activity').insert({ job_id: d.job_id, kind: 'system', text: `${d.kind === 'invoice' ? 'Invoice' : 'Estimate'} duplicated` });
  refresh(copy.id, d.job_id);
  redirect(`/documents/${copy.id}/edit`);
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
  const { data: est, error } = await supabase.from('documents').select('job_id, items, tax_rate, material_tax_rate, notes, internal_notes').eq('id', id).single();
  if (error) throw new Error(error.message);
  const today = todayISO();
  const { data: inv, error: e2 } = await supabase.from('documents').insert({
    kind: 'invoice', job_id: est.job_id, items: est.items, tax_rate: est.tax_rate, material_tax_rate: est.material_tax_rate,
    notes: est.notes, internal_notes: est.internal_notes,
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

/** Emails the customer link from the CRM (through Resend) and records it in the email log. */
export async function emailDocument(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireUser([...STAFF]);
  const id = uuid(fd, 'id');
  if (!id) return { error: 'Missing document.' };
  if (!emailConfigured()) return { error: 'Email sending is not connected yet. Use "Email the link" to send it from your own email app.' };
  const supabase = await createClient();
  const { data: token, error: e1 } = await supabase.rpc('share_document', { p_doc: id });
  if (e1) return { error: e1.message };
  const { data: d } = await supabase.from('documents').select('kind, number, job_id, jobs(contact_id)').eq('id', id).single();
  const contactId = (d?.jobs as unknown as { contact_id: string | null } | null)?.contact_id;
  if (!d || !contactId) return { error: 'This job has no customer to email.' };
  const { data: c } = await supabase.from('contacts').select('email').eq('id', contactId).single();
  if (!c?.email) return { error: 'Add an email address to the customer first.' };

  const isInvoice = d.kind === 'invoice';
  const label = `${isInvoice ? 'INV' : 'EST'}-${String(d.number).padStart(2, '0')}`;
  const link = `${siteUrl()}/e/${token}`;
  const body = isInvoice
    ? `Hi {{first_name}},\n\nHere is your invoice (${label}) for the work at {{address}}:\n${link}\n\nThank you for your business.\n\n{{rep_name}}\n{{company}} | {{company_phone}}`
    : `Hi {{first_name}},\n\nHere is your roofing estimate (${label}) for {{address}}. You can review it and sign online when you're ready:\n${link}\n\nAny questions, just reply to this email.\n\n{{rep_name}}\n{{company}} | {{company_phone}}`;
  const { error: e2 } = await supabase.from('outbox').insert({
    document_id: id, job_id: d.job_id, contact_id: contactId, to_email: c.email,
    subject: isInvoice ? `Your invoice from {{company}} (${label})` : `Your roofing estimate from {{company}}`,
    body, kind: 'followup', send_at: new Date().toISOString(), status: 'scheduled',
  });
  if (e2) return { error: e2.message };
  const r = await processOutbox(10);
  await supabase.from('job_activity').insert({ job_id: d.job_id, kind: 'system', text: `${label} emailed to ${c.email}` });
  refresh(id, d.job_id);
  revalidatePath('/emails');
  return r.sent ? { ok: `Sent to ${c.email}.` } : { ok: `Queued for ${c.email}; it will go out within a few minutes.` };
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
  // Which option they picked, which upgrades they ticked, and their answers (e.g. shingle color).
  const optRaw = String(fd.get('option') ?? '');
  const option = /^\d{1,2}$/.test(optRaw) ? Number(optRaw) : null;
  const upgrades = fd.getAll('upgrade').map(String).filter(v => /^\d{1,2}$/.test(v)).map(Number);
  const answers = fd.getAll('answer').map(v => String(v).trim().slice(0, 200)).slice(0, 6);
  const supabase = await createClient();
  const { error } = await supabase.rpc('sign_document', {
    p_token: token, p_name: name, p_signature: signature, p_ip: ip,
    p_option: option, p_upgrades: upgrades.length ? upgrades : null, p_answers: answers,
  });
  if (error) return { error: error.message };
  revalidatePath(`/e/${token}`);
  return { ok: 'signed' };
}
