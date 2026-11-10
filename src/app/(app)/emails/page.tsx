import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ConfirmButton, SubmitButton } from '@/components/client';
import { isAdmin, requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { emailConfigured } from '@/lib/email/send';
import { MERGE_KEYS } from '@/lib/email/compose';
import { STAGES } from '@/lib/stages';
import { fmtDateTime, todayISO } from '@/lib/format';
import { cancelEmail, deleteRule, deleteTemplate, saveRule, saveTemplate, sendSoon } from './actions';
import { CampaignForm, SendDueNow } from './forms';

export const metadata: Metadata = { title: 'Emails' };

const TABS = [['queue', 'Queue'], ['rules', 'Automatic follow-ups'], ['templates', 'Templates'], ['campaigns', 'Campaigns']] as const;

export default function EmailsPage({ searchParams }: PageProps<'/emails'>) {
  return (
    <>
      <div className="page-head"><h1>Emails</h1></div>
      <Suspense fallback={<div className="panel muted">Loading…</div>}>
        <Emails searchParams={searchParams} />
      </Suspense>
    </>
  );
}

type Template = { id: string; key: string | null; name: string; kind: string; subject: string; body: string };
type Rule = { id: string; name: string; stage: string; delay_days: number; template_id: string; stop_on_exit: boolean; active: boolean };

async function Emails({ searchParams }: { searchParams: PageProps<'/emails'>['searchParams'] }) {
  const me = await requireUser(['owner', 'office', 'rep']);
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as string) : 'queue';
  const admin = isAdmin(me);
  const configured = emailConfigured();

  return (
    <>
      {!configured && (
        <p className="notice">
          <b>Email sending isn&apos;t connected yet.</b> Follow-ups are being queued, but nothing goes out until the Resend settings are added (see SETUP.md). Nothing is lost in the meantime.
        </p>
      )}
      <nav className="tabs" aria-label="Email sections">
        {TABS.map(([k, l]) => <Link key={k} href={`/emails?tab=${k}`} className={tab === k ? 'on' : undefined}>{l}</Link>)}
      </nav>
      {tab === 'queue' && <Queue show={typeof sp.show === 'string' ? sp.show : 'upcoming'} />}
      {tab === 'rules' && <Rules admin={admin} />}
      {tab === 'templates' && <Templates admin={admin} />}
      {tab === 'campaigns' && <Campaigns admin={admin} />}
    </>
  );
}

const SHOW: Record<string, { label: string; statuses: string[] }> = {
  upcoming: { label: 'Upcoming', statuses: ['scheduled', 'sending'] },
  sent: { label: 'Sent', statuses: ['sent'] },
  problems: { label: 'Problems', statuses: ['failed', 'skipped'] },
  cancelled: { label: 'Cancelled', statuses: ['cancelled'] },
};

async function Queue({ show }: { show: string }) {
  const view = SHOW[show] ? show : 'upcoming';
  const supabase = await createClient();
  const { data } = await supabase.from('outbox')
    .select('id, to_email, subject, kind, status, reason, send_at, sent_at, delivered_at, opened_at, bounced_at, job_id, contact_id, jobs(number, name), contacts(first, last)')
    .in('status', SHOW[view].statuses)
    .order(view === 'upcoming' ? 'send_at' : 'created_at', { ascending: view === 'upcoming' })
    .limit(200);
  const rows = (data ?? []) as unknown as {
    id: string; to_email: string; subject: string; kind: string; status: string; reason: string; send_at: string; sent_at: string | null;
    delivered_at: string | null; opened_at: string | null; bounced_at: string | null; job_id: string | null; contact_id: string | null;
    jobs: { number: number; name: string } | null; contacts: { first: string; last: string } | null;
  }[];

  return (
    <section className="panel">
      <div className="panel-head">
        <div className="seg" role="group" aria-label="Which emails">
          {Object.entries(SHOW).map(([k, v]) => <Link key={k} href={`/emails?tab=queue&show=${k}`} className={view === k ? 'on' : ''}>{v.label}</Link>)}
        </div>
        <SendDueNow />
      </div>
      {rows.length === 0 && <p className="muted">No emails here.</p>}
      {rows.map(r => (
        <div className="line-item" key={r.id}>
          <span className="grow">
            <b>{r.subject}</b>{r.kind === 'marketing' && <> <span className="pill">Marketing</span></>}
            <small>
              {[r.contacts ? `${r.contacts.first} ${r.contacts.last}`.trim() : r.to_email, r.jobs ? `Job #${r.jobs.number}` : '',
                r.status === 'sent' ? `Sent ${fmtDateTime(r.sent_at)}` : `${r.status === 'scheduled' ? 'Sends' : 'Was due'} ${fmtDateTime(r.send_at)}`, r.reason].filter(Boolean).join(' · ')}
            </small>
          </span>
          {r.status === 'sent' && (
            <span className={`badge ${r.bounced_at ? 'bad' : r.opened_at ? 'good' : r.delivered_at ? 'info' : ''}`}>
              {r.bounced_at ? 'bounced' : r.opened_at ? 'opened' : r.delivered_at ? 'delivered' : 'sent'}
            </span>
          )}
          {r.status !== 'sent' && <span className={`badge ${r.status === 'failed' ? 'bad' : r.status === 'skipped' ? 'warn' : ''}`}>{r.status}</span>}
          {r.job_id && <Link className="btn small hide-sm" href={`/jobs/${r.job_id}`}>Job</Link>}
          {['scheduled', 'failed'].includes(r.status) && (
            <form action={sendSoon}><input type="hidden" name="id" value={r.id} /><SubmitButton className="btn small" pendingText="…">Send now</SubmitButton></form>
          )}
          {r.status === 'scheduled' && (
            <form action={cancelEmail}><input type="hidden" name="id" value={r.id} /><ConfirmButton message="Cancel this email?" className="icon-btn">×</ConfirmButton></form>
          )}
        </div>
      ))}
    </section>
  );
}

async function Rules({ admin }: { admin: boolean }) {
  const supabase = await createClient();
  const [{ data: rules }, { data: templates }] = await Promise.all([
    supabase.from('automation_rules').select('*').order('stage').order('delay_days'),
    supabase.from('templates').select('id, name, kind').order('name'),
  ]);
  const tpl = (templates ?? []) as { id: string; name: string; kind: string }[];
  const stageName = (id: string) => STAGES.find(s => s.id === id)?.name ?? id;
  const sorted = ((rules ?? []) as Rule[]).sort((a, b) => STAGES.findIndex(s => s.id === a.stage) - STAGES.findIndex(s => s.id === b.stage) || a.delay_days - b.delay_days);


  return (
    <section className="panel">
      <p className="muted" style={{ marginBottom: 10 }}>
        When a job moves to a stage, these emails are queued for the customer. &quot;Cancel if the job moves on&quot; stops, say, an estimate reminder once the job is sold.
      </p>
      {sorted.map(r => (
        <div key={r.id} className={`rule-row${r.active ? '' : ' off'}`}>
          <div className="muted rule-label">{stageName(r.stage)}</div>
          <RuleForm r={r} admin={admin} tpl={tpl} />
          {admin && <form action={deleteRule}><input type="hidden" name="id" value={r.id} /><ConfirmButton message={`Delete the rule "${r.name}"?`} className="icon-btn">×</ConfirmButton></form>}
        </div>
      ))}
      {admin && <><h3>Add a rule</h3><RuleForm admin={admin} tpl={tpl} /></>}
    </section>
  );
}

async function Templates({ admin }: { admin: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase.from('templates').select('*').order('kind').order('name');
  const templates = (data ?? []) as Template[];
  return (
    <>
      <p className="notice">
        Fill-ins you can use: {MERGE_KEYS.map(k => <code key={k} className="merge-key">{`{{${k}}}`}</code>)}
      </p>
      {templates.map(t => (
        <details className="panel template-box" key={t.id}>
          <summary><b>{t.name}</b> {t.kind === 'marketing' && <span className="pill">Marketing</span>}<small>{t.subject}</small></summary>
          <TemplateForm t={t} admin={admin} />
          {admin && (
            <form action={deleteTemplate} style={{ marginTop: 8 }}>
              <input type="hidden" name="id" value={t.id} />
              <ConfirmButton message={`Delete "${t.name}"? Rules using it are removed too.`}>Delete template</ConfirmButton>
            </form>
          )}
        </details>
      ))}
      {admin && <section className="panel"><div className="panel-head"><h2>New template</h2></div><TemplateForm admin={admin} /></section>}
    </>
  );
}

async function Campaigns({ admin }: { admin: boolean }) {
  const supabase = await createClient();
  const [{ data: camps }, { data: templates }, { data: stats }] = await Promise.all([
    supabase.from('campaigns').select('id, name, audience_label, recipient_count, created_at, templates(name)').order('created_at', { ascending: false }),
    supabase.from('templates').select('id, name').eq('kind', 'marketing').order('name'),
    supabase.from('outbox').select('campaign_id, status, opened_at').not('campaign_id', 'is', null),
  ]);
  const by = (id: string) => (stats ?? []).filter(s => s.campaign_id === id);
  return (
    <div className="grid-2">
      <section className="panel">
        <div className="panel-head"><h2>Past campaigns</h2></div>
        {!camps?.length && <p className="muted">No campaigns yet.</p>}
        {camps?.map(c => {
          const s = by(c.id);
          return (
            <div className="line-item" key={c.id}>
              <span className="grow"><b>{c.name}</b><small>{c.audience_label} · {(c.templates as unknown as { name: string } | null)?.name ?? 'Template removed'} · {fmtDateTime(c.created_at)}</small></span>
              <span className="num">{s.filter(x => x.status === 'sent').length}/{c.recipient_count} sent{s.some(x => x.opened_at) ? ` · ${s.filter(x => x.opened_at).length} opened` : ''}</span>
            </div>
          );
        })}
      </section>
      {admin && (
        <section className="panel">
          <div className="panel-head"><h2>New campaign</h2></div>
          <CampaignForm templates={(templates ?? []) as { id: string; name: string }[]} today={todayISO()} />
        </section>
      )}
    </div>
  );
}

function RuleForm({ r, admin, tpl }: { r?: Rule; admin: boolean; tpl: { id: string; name: string }[] }) {
  return (
    <form action={saveRule} className="rule-form">
      {r && <input type="hidden" name="id" value={r.id} />}
      <input name="name" defaultValue={r?.name} placeholder="Rule name" aria-label="Rule name" required disabled={!admin} />
      <span>When a job enters</span>
      <select name="stage" defaultValue={r?.stage ?? 'lead'} aria-label="Stage" disabled={!admin}>{STAGES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <span>wait</span>
      <input name="delay_days" type="number" min={0} max={365} defaultValue={r?.delay_days ?? 0} aria-label="Days to wait" style={{ width: 64 }} disabled={!admin} />
      <span>days, then send</span>
      <select name="template_id" defaultValue={r?.template_id ?? ''} aria-label="Template" required disabled={!admin}>
        <option value="" disabled>Template…</option>{tpl.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <label><input type="checkbox" name="stop_on_exit" defaultChecked={r?.stop_on_exit ?? true} disabled={!admin} /> Cancel if the job moves on</label>
      <label><input type="checkbox" name="active" defaultChecked={r?.active ?? true} disabled={!admin} /> On</label>
      {admin && <SubmitButton className="btn small" pendingText="…">{r ? 'Save' : 'Add rule'}</SubmitButton>}
    </form>
  );
}

function TemplateForm({ t, admin }: { t?: Template; admin: boolean }) {
  return (
    <form action={saveTemplate} className="form-grid">
      {t && <input type="hidden" name="id" value={t.id} />}
      <div className="field"><label>Name<input name="name" defaultValue={t?.name} required disabled={!admin} /></label></div>
      <div className="field"><label>Type
        <select name="kind" defaultValue={t?.kind ?? 'followup'} disabled={!admin}>
          <option value="followup">Follow-up (about their job)</option>
          <option value="marketing">Marketing (opt-in only, adds unsubscribe)</option>
        </select></label></div>
      <div className="field" style={{ gridColumn: '1 / -1' }}><label>Subject<input name="subject" defaultValue={t?.subject} required disabled={!admin} /></label></div>
      <div className="field" style={{ gridColumn: '1 / -1' }}><label>Message<textarea name="body" rows={7} defaultValue={t?.body} required disabled={!admin} /></label></div>
      {admin && <div><SubmitButton pendingText="Saving…">{t ? 'Save template' : 'Add template'}</SubmitButton></div>}
    </form>
  );
}
