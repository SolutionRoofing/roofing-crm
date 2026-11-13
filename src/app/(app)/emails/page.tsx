import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ConfirmButton, SubmitButton } from '@/components/client';
import { isAdmin, requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { emailConfigured } from '@/lib/email/send';
import { STAGES } from '@/lib/stages';
import { fmtDateTime, todayISO } from '@/lib/format';
import { cancelEmail, deleteRule, deleteTemplate, saveRule, sendSoon } from './actions';
import { CampaignForm, SendDueNow, TemplateEditor } from './forms';

export const metadata: Metadata = { title: 'Emails' };

const TABS = [['queue', 'Queue'], ['rules', 'Automatic follow-ups'], ['templates', 'Templates'], ['campaigns', 'Campaigns']] as const;
const TZ = process.env.BUSINESS_TIMEZONE || 'America/New_York';

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
      {tab === 'templates' && <Templates admin={admin} repName={me.fullName} />}
      {tab === 'campaigns' && <Campaigns admin={admin} />}
    </>
  );
}

// ---------------------------------------------------------------- Queue

const SHOW: Record<string, { label: string; statuses: string[] }> = {
  upcoming: { label: 'Upcoming', statuses: ['scheduled', 'sending'] },
  sent: { label: 'Sent', statuses: ['sent'] },
  problems: { label: 'Problems', statuses: ['failed', 'skipped'] },
  cancelled: { label: 'Cancelled', statuses: ['cancelled'] },
};

const localDay = (ts: string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
const localTime = (ts: string) => new Date(ts).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
function dayHeading(day: string, today: string) {
  const diff = Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
}

/** Cut-offs for the queue numbers: a week ahead and 30 days back. */
function timeWindows() {
  const now = Date.now();
  return { in7: new Date(now + 7 * 86400000).toISOString(), ago30: new Date(now - 30 * 86400000).toISOString() };
}

async function Queue({ show }: { show: string }) {
  const view = SHOW[show] ? show : 'upcoming';
  const supabase = await createClient();
  const { in7, ago30 } = timeWindows();
  const count = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then(r => r.count ?? 0);
  const head = () => supabase.from('outbox').select('id', { count: 'exact', head: true });

  const [{ data }, upcoming7, sent30, delivered30, opened30, problems30] = await Promise.all([
    supabase.from('outbox')
      .select('id, to_email, subject, kind, status, reason, send_at, sent_at, created_at, delivered_at, opened_at, bounced_at, job_id, contact_id, jobs(number, name), contacts(first, last)')
      .in('status', SHOW[view].statuses)
      .order(view === 'upcoming' ? 'send_at' : view === 'sent' ? 'sent_at' : 'created_at', { ascending: view === 'upcoming' })
      .limit(200),
    count(head().in('status', ['scheduled', 'sending']).lte('send_at', in7)),
    count(head().eq('status', 'sent').gte('sent_at', ago30)),
    count(head().eq('status', 'sent').gte('sent_at', ago30).or('delivered_at.not.is.null,opened_at.not.is.null')),
    count(head().eq('status', 'sent').gte('sent_at', ago30).not('opened_at', 'is', null)),
    count(head().in('status', ['failed', 'skipped']).gte('created_at', ago30)),
  ]);
  const rows = (data ?? []) as unknown as {
    id: string; to_email: string; subject: string; kind: string; status: string; reason: string; send_at: string; sent_at: string | null; created_at: string;
    delivered_at: string | null; opened_at: string | null; bounced_at: string | null; job_id: string | null; contact_id: string | null;
    jobs: { number: number; name: string } | null; contacts: { first: string; last: string } | null;
  }[];

  const today = todayISO();
  const whenOf = (r: (typeof rows)[number]) => (view === 'upcoming' ? r.send_at : view === 'sent' ? (r.sent_at ?? r.send_at) : r.created_at);
  const groups: [string, typeof rows][] = [];
  for (const r of rows) {
    const d = localDay(whenOf(r));
    const last = groups[groups.length - 1];
    if (last && last[0] === d) last[1].push(r); else groups.push([d, [r]]);
  }
  const openRate = sent30 ? Math.round((opened30 / sent30) * 100) : null;

  return (
    <>
      <div className="tiles mail-tiles">
        <Link href="/emails?tab=queue&show=upcoming" className="tile"><span className="tile-label">Going out in 7 days</span><span className="tile-value">{upcoming7}</span></Link>
        <Link href="/emails?tab=queue&show=sent" className="tile"><span className="tile-label">Sent · last 30 days</span><span className="tile-value">{sent30}</span>{sent30 > 0 && <span className="tile-sub">{delivered30} delivered</span>}</Link>
        <Link href="/emails?tab=queue&show=sent" className="tile"><span className="tile-label">Opened · last 30 days</span><span className="tile-value">{openRate === null ? '—' : `${openRate}%`}</span>{sent30 > 0 && <span className="tile-sub">{opened30} of {sent30}</span>}</Link>
        <Link href="/emails?tab=queue&show=problems" className={`tile${problems30 ? ' warn' : ''}`}><span className="tile-label">Problems · last 30 days</span><span className="tile-value">{problems30}</span>{problems30 > 0 && <span className="tile-sub">Failed or skipped</span>}</Link>
      </div>
      <section className="panel">
        <div className="panel-head">
          <div className="seg" role="group" aria-label="Which emails">
            {Object.entries(SHOW).map(([k, v]) => <Link key={k} href={`/emails?tab=queue&show=${k}`} className={view === k ? 'on' : ''}>{v.label}</Link>)}
          </div>
          <SendDueNow />
        </div>
        {rows.length === 0 && (
          <p className="empty-note">
            {view === 'upcoming' ? 'Nothing queued. Follow-ups are added here automatically when a job changes stage.' : 'No emails here.'}
          </p>
        )}
        {groups.map(([day, list]) => (
          <div key={day} className="mail-day">
            <h3>{dayHeading(day, today)}<span className="muted"> · {list.length}</span></h3>
            {list.map(r => {
              const who = r.contacts ? `${r.contacts.first} ${r.contacts.last}`.trim() || r.to_email : r.to_email;
              const state = r.status === 'sent'
                ? (r.bounced_at ? ['bad', 'Bounced'] : r.opened_at ? ['good', 'Opened'] : r.delivered_at ? ['info', 'Delivered'] : ['', 'Sent'])
                : r.status === 'failed' ? ['bad', 'Failed'] : r.status === 'skipped' ? ['warn', 'Skipped'] : r.status === 'cancelled' ? ['', 'Cancelled'] : ['', r.status === 'sending' ? 'Sending' : 'Queued'];
              return (
                <div className="line-item mail-row" key={r.id}>
                  <span className="when">{localTime(whenOf(r))}</span>
                  <span className="grow">
                    <b>{who}</b>{r.jobs && <span className="muted"> · Job #{r.jobs.number}</span>}{r.kind === 'marketing' && <> <span className="pill">Marketing</span></>}
                    <small>{r.subject}{r.reason ? ` · ${r.reason}` : ''}</small>
                  </span>
                  <span className={`badge ${state[0]}`}>{state[1]}</span>
                  {r.job_id && <Link className="btn small hide-sm" href={`/jobs/${r.job_id}`}>Job</Link>}
                  {['scheduled', 'failed'].includes(r.status) && (
                    <form action={sendSoon}><input type="hidden" name="id" value={r.id} /><SubmitButton className="btn small" pendingText="…">Send now</SubmitButton></form>
                  )}
                  {r.status === 'scheduled' && (
                    <form action={cancelEmail}><input type="hidden" name="id" value={r.id} /><ConfirmButton message={`Cancel this email to ${who}?`} className="icon-btn">×</ConfirmButton></form>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {rows.length === 200 && <p className="muted" style={{ marginTop: 8 }}>Showing the first 200.</p>}
      </section>
    </>
  );
}

// ---------------------------------------------------------------- Automatic follow-ups

const dayLabel = (n: number) => (n === 0 ? 'Same day' : n === 1 ? 'Day 1' : `Day ${n}`);

async function Rules({ admin }: { admin: boolean }) {
  const supabase = await createClient();
  const [{ data: rules }, { data: templates }] = await Promise.all([
    supabase.from('automation_rules').select('*'),
    supabase.from('templates').select('id, name, kind').order('name'),
  ]);
  const tpl = (templates ?? []) as { id: string; name: string; kind: string }[];
  const all = (rules ?? []) as Rule[];
  const stages = STAGES.map(s => ({ ...s, rules: all.filter(r => r.stage === s.id).sort((a, b) => a.delay_days - b.delay_days) }));
  const used = stages.filter(s => s.rules.length);
  const unused = stages.filter(s => !s.rules.length);

  return (
    <>
      <p className="muted" style={{ marginBottom: 12 }}>
        When a job moves to a stage, these emails are queued for the customer, counting days from when it got there.
        &quot;Stops if the job moves on&quot; cancels, say, an estimate reminder once the job is sold.
      </p>
      <div className="flow-list">
        {used.map(s => (
          <section className="panel flow" key={s.id}>
            <div className="flow-head">
              <span className={`badge stage-${s.group}`}>{s.name}</span>
              <span className="muted">When a job enters this stage</span>
            </div>
            <ol className="flow-steps">
              {s.rules.map(r => {
                const t = tpl.find(x => x.id === r.template_id);
                return (
                  <li key={r.id} className={`flow-step${r.active ? '' : ' off'}`}>
                    <span className="flow-day">{dayLabel(r.delay_days)}</span>
                    <div className="flow-body">
                      <b>{r.name}</b>
                      <small>
                        Sends <Link href={`/emails?tab=templates#t-${r.template_id}`}>{t?.name ?? 'a missing template'}</Link>
                        {r.stop_on_exit ? ' · Stops if the job moves on' : ' · Sends even if the job moves on'}
                      </small>
                    </div>
                    {!r.active && <span className="badge">Off</span>}
                    {admin && (
                      <details className="flow-edit">
                        <summary className="btn small">Edit</summary>
                        <div className="flow-edit-box">
                          <RuleForm r={r} tpl={tpl} />
                          <form action={deleteRule}>
                            <input type="hidden" name="id" value={r.id} />
                            <ConfirmButton message={`Delete the follow-up "${r.name}"?`} className="btn small danger-ghost">Delete</ConfirmButton>
                          </form>
                        </div>
                      </details>
                    )}
                  </li>
                );
              })}
            </ol>
            {admin && (
              <details className="flow-add">
                <summary className="link-btn">+ Add a follow-up to {s.name}</summary>
                <div className="flow-edit-box"><RuleForm tpl={tpl} stage={s.id} /></div>
              </details>
            )}
          </section>
        ))}
      </div>
      {admin && (
        <section className="panel">
          <div className="panel-head"><h2>Start follow-ups for another stage</h2></div>
          {unused.length > 0 && <p className="muted" style={{ marginBottom: 8 }}>No emails yet for: {unused.map(s => s.name).join(', ')}.</p>}
          <RuleForm tpl={tpl} stage={unused[0]?.id ?? 'lead'} />
        </section>
      )}
    </>
  );
}

function RuleForm({ r, tpl, stage }: { r?: Rule; tpl: { id: string; name: string }[]; stage?: string }) {
  return (
    <form action={saveRule} className="rule-form">
      {r && <input type="hidden" name="id" value={r.id} />}
      <label className="rule-name">Name <input name="name" defaultValue={r?.name} placeholder="e.g. Estimate follow-up after 3 days" required /></label>
      <span>When a job enters</span>
      <select name="stage" defaultValue={r?.stage ?? stage ?? 'lead'} aria-label="Stage">{STAGES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <span>wait</span>
      <input name="delay_days" type="number" min={0} max={365} defaultValue={r?.delay_days ?? 0} aria-label="Days to wait" style={{ width: 64 }} />
      <span>days, then send</span>
      <select name="template_id" defaultValue={r?.template_id ?? ''} aria-label="Template" required>
        <option value="" disabled>Template…</option>{tpl.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <label><input type="checkbox" name="stop_on_exit" defaultChecked={r?.stop_on_exit ?? true} /> Stop if the job moves on</label>
      <label><input type="checkbox" name="active" defaultChecked={r?.active ?? true} /> On</label>
      <SubmitButton className="btn small primary" pendingText="…">{r ? 'Save' : 'Add follow-up'}</SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------- Templates

async function Templates({ admin, repName }: { admin: boolean; repName: string }) {
  const supabase = await createClient();
  const [{ data }, { data: rules }, { data: s }] = await Promise.all([
    supabase.from('templates').select('*').order('kind').order('name'),
    supabase.from('automation_rules').select('template_id'),
    supabase.from('settings').select('company, phone, address, review_url').eq('id', 1).maybeSingle(),
  ]);
  const templates = (data ?? []) as Template[];
  const uses = (id: string) => (rules ?? []).filter(r => r.template_id === id).length;
  const company = { company: s?.company || 'Solution Roofing', address: s?.address || '' };
  const sample = {
    first_name: 'Pat', last_name: 'Sample', full_name: 'Pat Sample', address: '123 Main St, Cincinnati, OH',
    job_number: '1042', company: company.company, company_phone: s?.phone || '', rep_name: repName || 'Your rep',
    estimate_total: '$14,850.00', review_link: s?.review_url || 'https://g.page/r/your-review-link',
  };

  return (
    <>
      {templates.map(t => (
        <details className="panel template-box" key={t.id} id={`t-${t.id}`}>
          <summary>
            <span className="grow">
              <b>{t.name}</b> {t.kind === 'marketing' && <span className="pill">Marketing</span>}
              <small>{t.subject}</small>
            </span>
            <span className="muted tpl-uses">{uses(t.id) ? `Used by ${uses(t.id)} follow-up${uses(t.id) === 1 ? '' : 's'}` : t.kind === 'marketing' ? 'For campaigns' : 'Not used'}</span>
            <span className="btn small">{admin ? 'Edit' : 'View'}</span>
          </summary>
          <TemplateEditor t={t} admin={admin} sample={sample} company={company} />
          {admin && (
            <form action={deleteTemplate} style={{ marginTop: 10 }}>
              <input type="hidden" name="id" value={t.id} />
              <ConfirmButton message={`Delete "${t.name}"?${uses(t.id) ? ` ${uses(t.id)} follow-up(s) using it are removed too.` : ''}`}>Delete template</ConfirmButton>
            </form>
          )}
        </details>
      ))}
      {admin && (
        <details className="panel template-box">
          <summary><span className="grow"><b>+ New template</b></span></summary>
          <TemplateEditor admin={admin} sample={sample} company={company} />
        </details>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Campaigns

async function Campaigns({ admin }: { admin: boolean }) {
  const supabase = await createClient();
  const [{ data: camps }, { data: templates }, { data: stats }] = await Promise.all([
    supabase.from('campaigns').select('id, name, audience_label, recipient_count, created_at, templates(name)').order('created_at', { ascending: false }),
    supabase.from('templates').select('id, name').eq('kind', 'marketing').order('name'),
    supabase.from('outbox').select('campaign_id, status, send_at, opened_at, bounced_at').not('campaign_id', 'is', null),
  ]);
  const by = (id: string) => (stats ?? []).filter(s => s.campaign_id === id);
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  return (
    <div className="grid-2 campaigns">
      {admin && (
        <section className="panel">
          <div className="panel-head"><h2>New campaign</h2></div>
          <CampaignForm templates={(templates ?? []) as { id: string; name: string }[]} today={todayISO()} />
          {!templates?.length && <p className="muted" style={{ marginTop: 8 }}>Make a <Link href="/emails?tab=templates">marketing template</Link> first.</p>}
        </section>
      )}
      <section className="panel">
        <div className="panel-head"><h2>Past campaigns</h2></div>
        {!camps?.length && <p className="empty-note">No campaigns yet. A campaign emails a group of customers who agreed to marketing, like a spring storm check.</p>}
        {camps?.map(c => {
          const s = by(c.id);
          const sent = s.filter(x => x.status === 'sent').length;
          const opened = s.filter(x => x.opened_at).length;
          const problems = s.filter(x => x.bounced_at || ['failed', 'skipped'].includes(x.status)).length;
          const queued = s.filter(x => ['scheduled', 'sending'].includes(x.status)).length;
          const sendAt = s[0]?.send_at;
          return (
            <div className="camp" key={c.id}>
              <div className="camp-top">
                <b>{c.name}</b>
                <small className="muted">{c.audience_label} · {(c.templates as unknown as { name: string } | null)?.name ?? 'Template removed'} · {queued ? `sends ${fmtDateTime(sendAt)}` : `queued ${fmtDateTime(c.created_at)}`}</small>
              </div>
              <div className="camp-stats">
                <div><span className="tile-label">Recipients</span><b>{c.recipient_count}</b></div>
                <div><span className="tile-label">Sent</span><b>{sent}</b></div>
                <div><span className="tile-label">Opened</span><b>{pct(opened, sent)}</b></div>
                <div className={problems ? 'warn' : undefined}><span className="tile-label">Problems</span><b>{problems}</b></div>
              </div>
              {c.recipient_count > 0 && (
                <div className="camp-bar" role="img" aria-label={`${sent} of ${c.recipient_count} sent, ${opened} opened`}>
                  <span className="sent" style={{ width: `${(sent / c.recipient_count) * 100}%` }} />
                  <span className="opened" style={{ width: `${(opened / c.recipient_count) * 100}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
