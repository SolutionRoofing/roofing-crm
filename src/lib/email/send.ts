import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildEmail, type MergeData } from './compose';

// Sends due emails from the outbox through Resend. Runs on a schedule (see
// /api/cron/send-emails) and on demand from the Emails screen.

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
export const siteUrl = () => (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');

type ResendInput = {
  to: string; subject: string; text: string; html: string; replyTo?: string;
  headers?: Record<string, string>; idempotencyKey: string;
};

export async function sendViaResend(m: ResendInput): Promise<{ id?: string; error?: string; retry: boolean }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': m.idempotencyKey,
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM, to: [m.to], subject: m.subject, text: m.text, html: m.html,
      ...(m.replyTo ? { reply_to: m.replyTo } : {}), ...(m.headers ? { headers: m.headers } : {}),
    }),
  }).catch((e: Error) => ({ ok: false, status: 0, json: async () => ({ message: e.message }) }) as unknown as Response);
  const body = await res.json().catch(() => ({})) as { id?: string; message?: string };
  if (res.ok && body.id) return { id: body.id, retry: false };
  // Network trouble, rate limits and Resend outages are worth retrying; bad addresses are not.
  const retry = res.status === 0 || res.status === 429 || res.status >= 500;
  return { error: body.message || `Resend error ${res.status}`, retry };
}

type Row = {
  id: string; contact_id: string | null; job_id: string | null; to_email: string; subject: string; body: string;
  kind: string; attempts: number;
};

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function processOutbox(limit = 50) {
  const summary = { sent: 0, skipped: 0, failed: 0, retrying: 0, configured: emailConfigured() };
  if (!summary.configured) return summary;
  const db = createAdminClient();
  const { data: rows, error } = await db.rpc('claim_outbox', { p_limit: limit });
  if (error) throw new Error(error.message);
  if (!rows?.length) return summary;

  const { data: s } = await db.from('settings').select('company, phone, email, address, review_url').eq('id', 1).single();
  const company = s ?? { company: '', phone: '', email: '', address: '', review_url: '' };

  for (const row of rows as Row[]) {
    const finish = (patch: Record<string, unknown>) => db.from('outbox').update(patch).eq('id', row.id);
    try {
      const { data: c } = row.contact_id
        ? await db.from('contacts').select('first, last, email, address, marketing, unsubscribed_at, unsubscribe_token').eq('id', row.contact_id).maybeSingle()
        : { data: null };
      const to = (c?.email || row.to_email || '').trim();
      if (!to) { await finish({ status: 'skipped', reason: 'No email address on contact' }); summary.skipped++; continue; }
      if (row.kind === 'marketing' && (!c?.marketing || c.unsubscribed_at)) {
        await finish({ status: 'skipped', reason: 'Contact has not opted in to marketing' }); summary.skipped++; continue;
      }

      let job: { number: number; rep_id: string | null } | null = null;
      let amount = 0;
      let rep: { full_name: string; email: string } | null = null;
      if (row.job_id) {
        const [{ data: j }, { data: v }] = await Promise.all([
          db.from('jobs').select('number, rep_id').eq('id', row.job_id).maybeSingle(),
          db.from('job_list').select('amount').eq('id', row.job_id).maybeSingle(),
        ]);
        job = j;
        amount = Number(v?.amount) || 0;
        if (j?.rep_id) rep = (await db.from('profiles').select('full_name, email').eq('id', j.rep_id).maybeSingle()).data;
      }

      const data: MergeData = {
        first_name: c?.first ?? '', last_name: c?.last ?? '', full_name: `${c?.first ?? ''} ${c?.last ?? ''}`.trim(),
        address: c?.address ?? '', job_number: job ? String(job.number) : '', company: company.company,
        company_phone: company.phone || company.company, rep_name: rep?.full_name || company.company,
        estimate_total: amount ? money(amount) : '', review_link: company.review_url || '',
      };
      const unsubscribeUrl = c?.unsubscribe_token ? `${siteUrl()}/u/${c.unsubscribe_token}` : undefined;
      const email = buildEmail({ subject: row.subject, body: row.body, kind: row.kind, data, company, unsubscribeUrl });
      const headers: Record<string, string> = {};
      if (row.kind === 'marketing' && unsubscribeUrl) {
        // One-click unsubscribe for Gmail/Yahoo (RFC 8058).
        headers['List-Unsubscribe'] = `<${siteUrl()}/api/unsubscribe/${c!.unsubscribe_token}>`;
        headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
      }

      const result = await sendViaResend({
        to, subject: email.subject, text: email.text, html: email.html,
        replyTo: rep?.email || company.email || undefined, headers, idempotencyKey: row.id,
      });
      if (result.id) {
        await finish({ status: 'sent', sent_at: new Date().toISOString(), provider_id: result.id, to_email: to, reason: '' });
        summary.sent++;
      } else if (result.retry && row.attempts < 5) {
        await finish({ status: 'scheduled', send_at: new Date(Date.now() + row.attempts * 10 * 60000).toISOString(), reason: `Will retry: ${result.error}` });
        summary.retrying++;
      } else {
        await finish({ status: 'failed', reason: result.error ?? 'Send failed' });
        summary.failed++;
      }
    } catch (e) {
      await finish({ status: 'scheduled', send_at: new Date(Date.now() + 10 * 60000).toISOString(), reason: `Will retry: ${e instanceof Error ? e.message : 'error'}` });
      summary.retrying++;
    }
    await sleep(250); // stay well under Resend's rate limit
  }
  return summary;
}
