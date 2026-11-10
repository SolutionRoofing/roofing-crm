'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { checked, isoDate, number, oneOf, text, uuid } from '@/lib/form';
import { CLAIM_STATUSES, JOB_TYPES, LEAD_SOURCES } from '@/lib/options';
import { STAGES } from '@/lib/stages';
import type { FormState } from '@/app/login/actions';

const STAFF = ['owner', 'office', 'rep'] as const;
const STAGE_IDS = STAGES.map(s => s.id);

function refreshJob(id?: string | null) {
  revalidatePath('/pipeline');
  revalidatePath('/jobs');
  revalidatePath('/dashboard');
  if (id) revalidatePath(`/jobs/${id}`);
}

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

/** Moves a job to a stage. Database triggers log it and queue or cancel follow-up emails. */
export async function changeStage(fd: FormData) {
  await requireUser([...STAFF]);
  const id = uuid(fd, 'id');
  const stage = oneOf(fd, 'stage', STAGE_IDS, 'lead');
  if (!id) return;
  const supabase = await createClient();
  const patch: { stage: string; lost_reason?: string } = { stage };
  if (stage === 'lost') patch.lost_reason = text(fd, 'lost_reason', 200) || 'No reason given';
  fail((await supabase.from('jobs').update(patch).eq('id', id)).error);
  refreshJob(id);
}

/** New lead: an existing or new customer plus a job. */
export async function createLead(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await requireUser([...STAFF]);
  const supabase = await createClient();
  let contactId = uuid(fd, 'contact_id');

  if (!contactId) {
    const first = text(fd, 'first', 80);
    const last = text(fd, 'last', 80);
    if (!first && !last) return { error: 'Enter the customer\'s name, or pick an existing customer.' };
    const { data, error } = await supabase.from('contacts').insert({
      first, last,
      phone: text(fd, 'phone', 40),
      email: text(fd, 'email', 200).toLowerCase(),
      address: text(fd, 'address', 200), city: text(fd, 'city', 80), st: text(fd, 'st', 2).toUpperCase(), zip: text(fd, 'zip', 10),
      source: oneOf(fd, 'source', LEAD_SOURCES, 'Other'),
      marketing: checked(fd, 'marketing'),
      notes: text(fd, 'notes', 4000),
    }).select('id').single();
    if (error) return { error: error.message };
    contactId = data.id;
  }

  const type = oneOf(fd, 'type', JOB_TYPES, 'Retail');
  const { data: contact } = await supabase.from('contacts').select('last').eq('id', contactId).single();
  const name = text(fd, 'name', 120) || `${contact?.last || 'New'} ${type === 'Insurance' ? 'Storm Claim' : 'Re-roof'}`;
  const { data: job, error } = await supabase.from('jobs').insert({
    name, contact_id: contactId, type,
    roof_type: text(fd, 'roof_type', 40), squares: number(fd, 'squares'), pitch: text(fd, 'pitch', 10),
    rep_id: uuid(fd, 'rep_id') ?? (me.role === 'rep' ? me.id : null),
  }).select('id').single();
  if (error) return { error: error.message };

  await supabase.from('job_activity').insert({ job_id: job.id, kind: 'system', text: 'Lead created' });
  refreshJob();
  revalidatePath('/contacts');
  redirect(`/jobs/${job.id}`);
}

export async function updateJob(fd: FormData) {
  await requireUser([...STAFF]);
  const id = uuid(fd, 'id');
  if (!id) return;
  const supabase = await createClient();
  fail((await supabase.from('jobs').update({
    name: text(fd, 'name', 120) || 'Job',
    type: oneOf(fd, 'type', JOB_TYPES, 'Retail'),
    roof_type: text(fd, 'roof_type', 40),
    squares: number(fd, 'squares'),
    pitch: text(fd, 'pitch', 10),
    rep_id: uuid(fd, 'rep_id'),
    value: number(fd, 'value'),
  }).eq('id', id)).error);
  refreshJob(id);
}

type Supplement = { id: string; desc: string; amount: number; status: string };
type Insurance = Record<string, unknown> & { supplements?: Supplement[] };

async function readInsurance(id: string): Promise<Insurance> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('jobs').select('insurance').eq('id', id).single();
  fail(error);
  return (data?.insurance as Insurance) ?? {};
}

async function writeInsurance(id: string, insurance: Insurance) {
  const supabase = await createClient();
  fail((await supabase.from('jobs').update({ insurance }).eq('id', id)).error);
  refreshJob(id);
}

export async function updateClaim(fd: FormData) {
  await requireUser([...STAFF]);
  const id = uuid(fd, 'id');
  if (!id) return;
  const current = await readInsurance(id);
  await writeInsurance(id, {
    ...current,
    carrier: text(fd, 'carrier', 120), claim: text(fd, 'claim', 60), policy: text(fd, 'policy', 60),
    adjuster: text(fd, 'adjuster', 120), adjPhone: text(fd, 'adjPhone', 40), adjEmail: text(fd, 'adjEmail', 200),
    dateOfLoss: isoDate(fd, 'dateOfLoss') ?? '', cause: text(fd, 'cause', 60),
    status: oneOf(fd, 'status', CLAIM_STATUSES, 'Not filed'),
    deductible: number(fd, 'deductible'), acv: number(fd, 'acv'), rcv: number(fd, 'rcv'),
    supplements: current.supplements ?? [],
  });
}

export async function addSupplement(fd: FormData) {
  await requireUser([...STAFF]);
  const id = uuid(fd, 'id');
  const desc = text(fd, 'desc', 200);
  if (!id || !desc) return;
  const current = await readInsurance(id);
  const supplements = [...(current.supplements ?? []), {
    id: crypto.randomUUID(), desc, amount: number(fd, 'amount'), status: oneOf(fd, 'status', ['Pending', 'Approved', 'Denied'], 'Pending'),
  }];
  await writeInsurance(id, { ...current, supplements });
}

export async function updateSupplement(fd: FormData) {
  await requireUser([...STAFF]);
  const id = uuid(fd, 'id');
  const suppId = text(fd, 'supp_id', 40);
  if (!id || !suppId) return;
  const current = await readInsurance(id);
  const remove = fd.get('remove') === '1';
  const status = oneOf(fd, 'status', ['Pending', 'Approved', 'Denied'], 'Pending');
  const supplements = (current.supplements ?? [])
    .filter(s => !(remove && s.id === suppId))
    .map(s => (s.id === suppId ? { ...s, status } : s));
  await writeInsurance(id, { ...current, supplements });
}

export async function addNote(fd: FormData) {
  await requireUser([...STAFF]);
  const id = uuid(fd, 'id');
  const note = text(fd, 'note', 4000);
  if (!id || !note) return;
  const supabase = await createClient();
  fail((await supabase.from('job_activity').insert({ job_id: id, kind: 'note', text: note })).error);
  refreshJob(id);
}

export async function createWorkOrder(fd: FormData) {
  await requireUser([...STAFF]);
  const id = uuid(fd, 'id');
  const crew = uuid(fd, 'crew_id');
  if (!id || !crew) return;
  const supabase = await createClient();
  const { data: woId, error } = await supabase.rpc('create_work_order', { p_job: id, p_crew: crew, p_date: isoDate(fd, 'scheduled_date') });
  fail(error);
  const materials = text(fd, 'materials', 2000);
  const accessNotes = text(fd, 'access_notes', 2000);
  if (materials || accessNotes) {
    fail((await supabase.from('work_orders').update({ materials, access_notes: accessNotes }).eq('id', woId as string)).error);
  }
  refreshJob(id);
  revalidatePath('/work-orders');
}

export async function deleteWorkOrder(fd: FormData) {
  await requireUser([...STAFF]);
  const id = uuid(fd, 'id');
  const job = uuid(fd, 'job_id');
  if (!id) return;
  const supabase = await createClient();
  fail((await supabase.from('work_orders').delete().eq('id', id)).error);
  refreshJob(job);
  revalidatePath('/work-orders');
}

/** Owner/office only (the database enforces it too). Removes the job and everything on it. */
export async function deleteJob(fd: FormData) {
  await requireUser(['owner', 'office']);
  const id = uuid(fd, 'id');
  if (!id) return;
  const supabase = await createClient();
  const { error, count } = await supabase.from('jobs').delete({ count: 'exact' }).eq('id', id);
  fail(error);
  if (!count) throw new Error('That job could not be deleted.');
  refreshJob();
  redirect('/jobs');
}
