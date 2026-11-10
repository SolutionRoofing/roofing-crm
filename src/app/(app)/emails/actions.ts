'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { checked, isoDate, number, oneOf, text, uuid } from '@/lib/form';
import { LEAD_SOURCES } from '@/lib/options';
import { STAGES } from '@/lib/stages';
import { emailConfigured, processOutbox } from '@/lib/email/send';
import type { FormState } from '@/app/login/actions';

const ADMIN = ['owner', 'office'] as const;
const STAFF = ['owner', 'office', 'rep'] as const;
const STAGE_IDS = STAGES.map(s => s.id);
const refresh = () => revalidatePath('/emails');
const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message); };

/** Sends everything that's due right now (normally the 10-minute schedule does this). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState passes the previous state
export async function sendDueNow(_prev: FormState): Promise<FormState> {
  await requireUser([...STAFF]);
  if (!emailConfigured()) return { error: 'Email sending is not connected yet. Add the Resend settings first (see SETUP.md).' };
  const r = await processOutbox(50);
  refresh();
  const parts = [`${r.sent} sent`, r.skipped && `${r.skipped} skipped`, r.retrying && `${r.retrying} will retry`, r.failed && `${r.failed} failed`].filter(Boolean);
  return { ok: r.sent + r.skipped + r.retrying + r.failed === 0 ? 'Nothing was due.' : parts.join(', ') + '.' };
}

export async function cancelEmail(fd: FormData) {
  await requireUser([...STAFF]);
  const id = uuid(fd, 'id');
  if (!id) return;
  const supabase = await createClient();
  fail((await supabase.from('outbox').update({ status: 'cancelled', reason: 'Cancelled by hand' }).eq('id', id).eq('status', 'scheduled')).error);
  refresh();
}

/** Moves a queued or failed email to "send at the next run". */
export async function sendSoon(fd: FormData) {
  await requireUser([...STAFF]);
  const id = uuid(fd, 'id');
  if (!id) return;
  const supabase = await createClient();
  fail((await supabase.from('outbox').update({ status: 'scheduled', send_at: new Date().toISOString(), reason: '' })
    .eq('id', id).in('status', ['scheduled', 'failed'])).error);
  refresh();
}

export async function saveRule(fd: FormData) {
  await requireUser([...ADMIN]);
  const id = uuid(fd, 'id');
  const row = {
    name: text(fd, 'name', 120) || 'Follow-up',
    stage: oneOf(fd, 'stage', STAGE_IDS, 'lead'),
    delay_days: Math.max(0, Math.min(365, Math.round(number(fd, 'delay_days')))),
    template_id: uuid(fd, 'template_id'),
    stop_on_exit: checked(fd, 'stop_on_exit'),
    active: checked(fd, 'active'),
  };
  if (!row.template_id) throw new Error('Pick a template.');
  const supabase = await createClient();
  fail((id ? await supabase.from('automation_rules').update(row).eq('id', id) : await supabase.from('automation_rules').insert(row)).error);
  refresh();
}

export async function deleteRule(fd: FormData) {
  await requireUser([...ADMIN]);
  const id = uuid(fd, 'id');
  if (!id) return;
  const supabase = await createClient();
  fail((await supabase.from('automation_rules').delete().eq('id', id)).error);
  refresh();
}

export async function saveTemplate(fd: FormData) {
  await requireUser([...ADMIN]);
  const id = uuid(fd, 'id');
  const row = {
    name: text(fd, 'name', 120) || 'Template',
    kind: oneOf(fd, 'kind', ['followup', 'marketing'] as const, 'followup'),
    subject: text(fd, 'subject', 200),
    body: text(fd, 'body', 10000),
  };
  if (!row.subject || !row.body) throw new Error('A template needs a subject and a message.');
  const supabase = await createClient();
  fail((id ? await supabase.from('templates').update(row).eq('id', id) : await supabase.from('templates').insert(row)).error);
  refresh();
}

export async function deleteTemplate(fd: FormData) {
  await requireUser([...ADMIN]);
  const id = uuid(fd, 'id');
  if (!id) return;
  const supabase = await createClient();
  fail((await supabase.from('templates').delete().eq('id', id)).error);
  refresh();
}

type AudienceContact = { id: string; email: string; source: string; jobs: { stage: string }[] };
const OPEN = STAGES.filter(s => s.group !== 'closed').map(s => s.id) as string[];

function audienceFilter(key: string) {
  return (c: AudienceContact) => {
    if (key === 'all') return true;
    if (key === 'past') return c.jobs.some(j => ['complete', 'invoiced', 'paid'].includes(j.stage));
    if (key === 'open') return c.jobs.some(j => OPEN.includes(j.stage));
    if (key === 'lost') return c.jobs.length > 0 && c.jobs.every(j => j.stage === 'lost');
    if (key.startsWith('source:')) return c.source === key.slice(7);
    return false;
  };
}

/** Queues a marketing email to every opted-in customer in the audience. */
export async function createCampaign(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireUser([...ADMIN]);
  const name = text(fd, 'name', 120);
  const templateId = uuid(fd, 'template_id');
  const audience = text(fd, 'audience', 60);
  const date = isoDate(fd, 'date');
  if (!name || !templateId || !date) return { error: 'Fill in the name, template and send date.' };
  if (!['all', 'past', 'open', 'lost'].includes(audience) && !LEAD_SOURCES.some(s => `source:${s}` === audience)) return { error: 'Pick an audience.' };

  const supabase = await createClient();
  const { data: t } = await supabase.from('templates').select('id, subject, body, kind').eq('id', templateId).single();
  if (!t || t.kind !== 'marketing') return { error: 'Campaigns use marketing templates (they get the unsubscribe footer).' };
  const { data: contacts } = await supabase.from('contacts')
    .select('id, email, source, jobs(stage)').eq('marketing', true).is('unsubscribed_at', null).neq('email', '');
  const people = ((contacts ?? []) as AudienceContact[]).filter(audienceFilter(audience));
  if (!people.length) return { error: 'No opted-in customers with an email match that audience.' };

  const sendAt = new Date(`${date}T14:00:00Z`).toISOString(); // about 8–9 AM in US Central time
  const { data: camp, error } = await supabase.from('campaigns')
    .insert({ name, template_id: templateId, audience_label: fd.get('audience_label')?.toString().slice(0, 80) ?? audience, recipient_count: people.length })
    .select('id').single();
  if (error) return { error: error.message };
  const { error: e2 } = await supabase.from('outbox').insert(people.map(p => ({
    campaign_id: camp.id, template_id: t.id, contact_id: p.id, to_email: p.email,
    subject: t.subject, body: t.body, kind: 'marketing', send_at: sendAt, status: 'scheduled',
  })));
  if (e2) return { error: e2.message };
  refresh();
  return { ok: `${people.length} emails queued for ${date}.` };
}
