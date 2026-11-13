import { MeasurementsPanel } from '@/components/measurements-panel';
import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Icon } from '@/components/icon';
import { ConfirmButton, StageSelect, SubmitButton } from '@/components/client';
import { EVENT_COLUMNS, EventForm, EventRow, TASK_COLUMNS, TaskForm, TaskRow, type CalEvent, type Task } from '@/components/work';
import { isAdmin, requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/form';
import { StageBadge } from '@/lib/jobs';
import { getPeople, personName } from '@/lib/staff';
import { daysSince, fmtDateTime, fmtDay, fullAddress, fullName, mapHref, money, moneyCents, telHref, todayISO } from '@/lib/format';
import { CLAIM_STATUSES, ROOF_TYPES } from '@/lib/options';
import { ServiceFields } from '@/components/job-fields';
import { displayStatus, docLabel, STATUS_BADGE } from '@/lib/documents';
import { getPhotos } from '@/lib/photos';
import { PhotoUploader } from '@/components/photo-upload';
import { PhotoGallery } from '@/components/photo-gallery';
import { PhotoShare } from '@/components/photo-share';
import { revokePhotoShare } from '@/app/(app)/photos/actions';
import { emailConfigured } from '@/lib/email/send';
import {
  addNote, addSupplement, changeStage, createWorkOrder, deleteJob, deleteWorkOrder, updateClaim, updateJob, updateSupplement,
} from '../actions';

export const metadata: Metadata = { title: 'Job' };

export default function JobPage({ params }: PageProps<'/jobs/[id]'>) {
  return (
    <>
      <Link className="crumb" href="/jobs"><Icon name="back" size={14} /> Jobs</Link>
      <Suspense fallback={<div className="panel muted">Loading…</div>}>
        <Job params={params} />
      </Suspense>
    </>
  );
}

type Supplement = { id: string; desc: string; amount: number; status: string };
type Insurance = {
  carrier?: string; claim?: string; policy?: string; adjuster?: string; adjPhone?: string; adjEmail?: string;
  dateOfLoss?: string; cause?: string; status?: string; deductible?: number; acv?: number; rcv?: number; supplements?: Supplement[];
};
type Line = { desc: string; qty: number; unit: string; price: number };
type Doc = { id: string; kind: string; number: number; status: string; date: string; due_date: string | null; items: Line[]; tax_rate: number; payments: { amount: number }[] };
type WorkOrder = { id: string; status: string; scheduled_date: string | null; crew_notes: string; crews: { name: string } | null };

const cents = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
function docTotals(d: Doc) {
  const subtotal = cents(d.items.reduce((s, l) => s + cents((Number(l.qty) || 0) * (Number(l.price) || 0)), 0));
  const total = cents(subtotal + cents(subtotal * (Number(d.tax_rate) || 0) / 100));
  const paid = cents(d.payments.reduce((s, p) => s + Number(p.amount), 0));
  return { total, paid, balance: cents(total - paid) };
}
function claimMath(ins: Insurance) {
  const rcv = Number(ins.rcv) || 0, acv = Number(ins.acv) || 0, ded = Number(ins.deductible) || 0;
  const approved = cents((ins.supplements ?? []).filter(s => s.status === 'Approved').reduce((a, s) => a + (Number(s.amount) || 0), 0));
  const totalClaim = cents(rcv + approved);
  return { approved, totalClaim, depreciation: Math.max(cents(rcv - acv), 0), firstCheck: Math.max(cents(acv - ded), 0), insurancePays: Math.max(cents(totalClaim - ded), 0) };
}
const WO_LABEL: Record<string, string> = { assigned: 'Not started', in_progress: 'In progress', done: 'Done' };

async function Job({ params }: { params: PageProps<'/jobs/[id]'>['params'] }) {
  const me = await requireUser(['owner', 'office', 'rep']);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();

  const { data: job } = await supabase.from('jobs').select('*').eq('id', id).maybeSingle();
  if (!job) notFound();

  const [contactRes, docsRes, tasksRes, eventsRes, wosRes, activityRes, valueRes, staff, photos, sharesRes] = await Promise.all([
    job.contact_id ? supabase.from('contacts').select('*').eq('id', job.contact_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('documents').select('id, kind, number, status, date, due_date, items, tax_rate, payments(amount)').eq('job_id', id).order('created_at'),
    supabase.from('tasks').select(TASK_COLUMNS).eq('job_id', id).order('done').order('due', { nullsFirst: false }),
    supabase.from('events').select(EVENT_COLUMNS).eq('job_id', id).order('date').order('time'),
    supabase.from('work_orders').select('id, status, scheduled_date, crew_notes, crews(name)').eq('job_id', id).order('created_at'),
    supabase.from('job_activity').select('id, at, kind, text, profiles(full_name, email)').eq('job_id', id).order('at', { ascending: false }).limit(100),
    supabase.from('job_list').select('amount').eq('id', id).maybeSingle(),
    getPeople(),
    getPhotos([id]),
    supabase.from('photo_shares').select('id, photo_ids, sent_to, created_at, viewed_at').eq('job_id', id).is('revoked_at', null).order('created_at', { ascending: false }),
  ]);
  const shares = (sharesRes.data ?? []) as { id: string; photo_ids: string[]; sent_to: string; created_at: string; viewed_at: string | null }[];
  const contact = contactRes.data;
  const docs = (docsRes.data ?? []) as unknown as Doc[];
  const tasks = (tasksRes.data ?? []) as unknown as Task[];
  const events = (eventsRes.data ?? []) as unknown as CalEvent[];
  const workOrders = (wosRes.data ?? []) as unknown as WorkOrder[];
  const activity = (activityRes.data ?? []) as unknown as { id: string; at: string; kind: string; text: string; profiles: { full_name: string; email: string } | null }[];
  const { people, crews } = staff;
  const ins = (job.insurance ?? {}) as Insurance;
  const today = todayISO();
  const address = fullAddress(contact);
  const rep = people.find(p => p.id === job.rep_id);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>#{job.number} {job.name}</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            <StageBadge stage={job.stage} /> {job.type === 'Insurance' && <span className="pill">Claim</span>}{' '}
            {job.services?.length ? `${job.services.join(', ')} · ` : ''}
            {daysSince(job.stage_changed_at)} days in this stage · {money(valueRes.data?.amount ?? job.value)}
            {job.stage === 'lost' && job.lost_reason ? ` · Lost: ${job.lost_reason}` : ''}
          </p>
        </div>
        <StageSelect action={changeStage} jobId={job.id} stage={job.stage} />
      </div>

      <nav className="tabs" aria-label="Job sections">
        <a href="#overview">Overview</a>
        {job.type === 'Insurance' && <a href="#claim">Claim</a>}
        <a href="#photos">Photos{photos.length ? ` (${photos.length})` : ''}</a>
        <a href="#schedule">Schedule</a>
        <a href="#tasks">Tasks</a>
        <a href="#money">Estimates</a>
        <a href="#activity">Activity</a>
      </nav>

      <div className="grid-2" id="overview">
        <section className="panel">
          <div className="panel-head">
            <h2>Customer</h2>
            {contact && <Link href={`/contacts/${contact.id}`}>Open customer</Link>}
          </div>
          {contact ? (
            <>
              <p><b>{fullName(contact)}</b></p>
              <div className="quick">
                {contact.phone && <a className="btn small" href={telHref(contact.phone)}><Icon name="phone" size={14} /> {contact.phone}</a>}
                {contact.email && <a className="btn small" href={`mailto:${contact.email}`}><Icon name="mail" size={14} /> Email</a>}
                {address && <a className="btn small" href={mapHref(address)} target="_blank" rel="noreferrer"><Icon name="pin" size={14} /> Map</a>}
              </div>
              <p className="muted">{address || 'No address on file'}</p>
              {contact.notes && <p style={{ marginTop: 8 }}>{contact.notes}</p>}
            </>
          ) : <p className="muted">No customer linked.</p>}
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Job details</h2></div>
          <form key={job.updated_at} action={updateJob} className="form-grid">
            <input type="hidden" name="id" value={job.id} />
            <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="jd-name">Name</label><input id="jd-name" name="name" defaultValue={job.name} required /></div>
            <ServiceFields selected={job.services ?? []} insurance={job.type === 'Insurance'} />
            <div className="field"><label htmlFor="jd-rep">Sales rep</label>
              <select id="jd-rep" name="rep_id" defaultValue={job.rep_id ?? ''}>
                <option value="">Unassigned</option>
                {people.map(p => <option key={p.id} value={p.id}>{personName(p)}</option>)}
                {job.rep_id && !rep && <option value={job.rep_id}>Former team member</option>}
              </select></div>
            <div className="field"><label htmlFor="jd-roof">Roof type</label>
              <select id="jd-roof" name="roof_type" defaultValue={job.roof_type}>
                <option value="">Not set</option>{ROOF_TYPES.map(t => <option key={t}>{t}</option>)}
              </select></div>
            <div className="form-grid" style={{ gap: 8 }}>
              <div className="field"><label htmlFor="jd-sq">Squares</label><input id="jd-sq" name="squares" inputMode="decimal" defaultValue={job.squares || ''} /></div>
              <div className="field"><label htmlFor="jd-pitch">Pitch</label><input id="jd-pitch" name="pitch" defaultValue={job.pitch} /></div>
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="jd-value">Expected value</label>
              <input id="jd-value" name="value" inputMode="decimal" defaultValue={job.value || ''} />
              <small>Used until there is an estimate; after that the estimate total counts.</small>
            </div>
            <div><SubmitButton>Save details</SubmitButton></div>
          </form>
        </section>
      </div>

      <MeasurementsPanel key={`m-${job.updated_at}`} jobId={job.id} raw={job.measurements} />

      {job.type === 'Insurance' && <Claim key={job.updated_at} jobId={job.id} ins={ins} />}

      <section className="panel" id="photos">
        <div className="panel-head">
          <h2>Photos</h2>
          <PhotoShare key={photos.length} jobId={job.id} photos={photos.map(p => ({ id: p.id, thumbUrl: p.thumbUrl, caption: p.caption }))}
            customerEmail={contact?.email ?? ''} emailReady={emailConfigured()} />
        </div>
        <PhotoUploader jobId={job.id} userId={me.id} />
        <PhotoGallery photos={photos} userId={me.id} canEditAll />
        {shares.length > 0 && (
          <div className="share-list">
            <h3>Customer photo links</h3>
            {shares.map(s => (
              <div className="share-row" key={s.id}>
                <span>
                  {fmtDateTime(s.created_at)} · {s.photo_ids.length} photo{s.photo_ids.length === 1 ? '' : 's'}
                  {s.sent_to ? ` · emailed to ${s.sent_to}` : ''}
                  {' · '}<span className={s.viewed_at ? 'good-text' : 'muted'}>{s.viewed_at ? `Opened ${fmtDateTime(s.viewed_at)}` : 'Not opened yet'}</span>
                </span>
                <form action={revokePhotoShare}>
                  <input type="hidden" name="id" value={s.id} />
                  <ConfirmButton message="Turn off this link? The customer will no longer be able to see these photos." className="btn small danger-ghost">Turn off</ConfirmButton>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid-2" id="schedule">
        <section className="panel">
          <div className="panel-head"><h2>Appointments</h2></div>
          {events.length === 0 && <p className="muted" style={{ marginBottom: 10 }}>Nothing scheduled.</p>}
          {events.map(e => <EventRow key={e.id} event={e} people={people} crews={crews} showJob={false} showDate />)}
          <details className="add-box">
            <summary className="btn small"><Icon name="plus" size={14} /> Add appointment</summary>
            <EventForm jobId={job.id} people={people} crews={crews} defaultDate={today} />
          </details>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Crew work orders</h2><Link href="/work-orders">All work orders</Link></div>
          {workOrders.length === 0 && <p className="muted" style={{ marginBottom: 10 }}>No work order yet.</p>}
          {workOrders.map(w => (
            <div className="line-item" key={w.id}>
              <span className="grow">
                <b>{w.crews?.name ?? 'Crew'}</b> <span className={`badge ${w.status === 'done' ? 'good' : w.status === 'in_progress' ? 'info' : ''}`}>{WO_LABEL[w.status]}</span>
                <small>{w.scheduled_date ? fmtDay(w.scheduled_date) : 'Not scheduled'}{w.crew_notes ? ` · Crew notes: ${w.crew_notes}` : ''}</small>
              </span>
              <form action={deleteWorkOrder}>
                <input type="hidden" name="id" value={w.id} /><input type="hidden" name="job_id" value={job.id} />
                <ConfirmButton message="Delete this work order? The crew will no longer see it." className="icon-btn">×</ConfirmButton>
              </form>
            </div>
          ))}
          <details className="add-box">
            <summary className="btn small"><Icon name="plus" size={14} /> Send to a crew</summary>
            {crews.length === 0 ? <p className="muted">Add crews on the Team page first.</p> : (
              <form action={createWorkOrder} className="form-grid">
                <input type="hidden" name="id" value={job.id} />
                <div className="field"><label htmlFor="wo-crew">Crew</label>
                  <select id="wo-crew" name="crew_id" required defaultValue="">
                    <option value="" disabled>Pick a crew</option>{crews.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select></div>
                <div className="field"><label htmlFor="wo-date">Install date</label><input id="wo-date" type="date" name="scheduled_date" /></div>
                <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="wo-mat">Materials</label><input id="wo-mat" name="materials" placeholder="e.g. Owens Corning Duration, Driftwood" /></div>
                <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="wo-notes">Site notes for the crew</label><input id="wo-notes" name="access_notes" placeholder="Gate code, dogs, where to put the dumpster" /></div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <SubmitButton pendingText="Sending…">Create work order</SubmitButton>
                  <small>The crew sees the address, scope and notes, with no prices. The scope comes from the accepted estimate.</small>
                </div>
              </form>
            )}
          </details>
        </section>
      </div>

      <section className="panel" id="tasks">
        <div className="panel-head"><h2>Tasks</h2></div>
        {tasks.map(t => <TaskRow key={t.id} task={t} people={people} today={today} showJob={false} />)}
        <TaskForm jobId={job.id} people={people} defaultAssignee={job.rep_id ?? me.id} />
      </section>

      <section className="panel" id="money">
        <div className="panel-head">
          <h2>Estimates and invoices</h2>
          <div className="quick" style={{ margin: 0 }}>
            <Link className="btn small primary" href={`/documents/new?job=${job.id}&kind=estimate`}><Icon name="plus" size={14} /> Estimate</Link>
            <Link className="btn small" href={`/documents/new?job=${job.id}&kind=invoice`}><Icon name="plus" size={14} /> Invoice</Link>
          </div>
        </div>
        {docs.length === 0 && <p className="muted">None yet.</p>}
        {docs.map(d => {
          const t = docTotals(d);
          const shown = displayStatus(d, t.total, t.paid, today);
          return (
            <Link className="line-item" key={d.id} href={`/documents/${d.id}`}>
              <span className="grow"><b>{docLabel(d)}</b> <span className={`badge ${STATUS_BADGE[shown] ?? ''}`}>{shown}</span>
                <small>{fmtDay(d.date)}{d.kind === 'invoice' && t.paid > 0 ? ` · Paid ${moneyCents(t.paid)}` : ''}</small></span>
              <span className="num">{moneyCents(t.total)}{d.kind === 'invoice' && <small>Balance {moneyCents(t.balance)}</small>}</span>
            </Link>
          );
        })}
      </section>

      <section className="panel" id="activity">
        <div className="panel-head"><h2>Notes and activity</h2></div>
        <form action={addNote} className="inline-form add-row" style={{ marginBottom: 8 }}>
          <input type="hidden" name="id" value={job.id} />
          <input name="note" placeholder="Add a note (call summary, gate code, anything)" required aria-label="Note" className="grow-input" />
          <SubmitButton className="btn small primary" pendingText="Adding…">Add note</SubmitButton>
        </form>
        {activity.map(a => (
          <div className="line-item" key={a.id}>
            <span className="when">{fmtDateTime(a.at)}</span>
            <span className="grow">{a.kind === 'note' ? <b>{a.text}</b> : a.text}
              {a.profiles && <small>{a.profiles.full_name || a.profiles.email}</small>}</span>
          </div>
        ))}
      </section>

      {isAdmin(me) && (
        <form action={deleteJob} style={{ marginTop: 8 }}>
          <input type="hidden" name="id" value={job.id} />
          <ConfirmButton message={`Delete job #${job.number} and all of its tasks, appointments, estimates, photos and notes? This cannot be undone.`}>Delete job</ConfirmButton>
        </form>
      )}
    </>
  );
}

function Claim({ jobId, ins }: { jobId: string; ins: Insurance }) {
  const m = claimMath(ins);
  return (
    <section className="panel" id="claim">
      <div className="panel-head"><h2>Insurance claim</h2><span className="badge info">{ins.status || 'Not filed'}</span></div>
      <div className="tiles claim-tiles">
        <div className="tile"><span className="tile-label">Total claim (RCV + supplements)</span><span className="tile-value">{money(m.totalClaim)}</span></div>
        <div className="tile"><span className="tile-label">First check (ACV − deductible)</span><span className="tile-value">{money(m.firstCheck)}</span></div>
        <div className="tile"><span className="tile-label">Depreciation held back</span><span className="tile-value">{money(m.depreciation)}</span></div>
        <div className="tile"><span className="tile-label">Insurance pays in total</span><span className="tile-value">{money(m.insurancePays)}</span></div>
      </div>
      <form action={updateClaim} className="form-grid three">
        <input type="hidden" name="id" value={jobId} />
        <div className="field"><label htmlFor="cl-carrier">Carrier</label><input id="cl-carrier" name="carrier" defaultValue={ins.carrier} /></div>
        <div className="field"><label htmlFor="cl-claim">Claim #</label><input id="cl-claim" name="claim" defaultValue={ins.claim} /></div>
        <div className="field"><label htmlFor="cl-policy">Policy #</label><input id="cl-policy" name="policy" defaultValue={ins.policy} /></div>
        <div className="field"><label htmlFor="cl-status">Status</label>
          <select id="cl-status" name="status" defaultValue={ins.status || 'Not filed'}>{CLAIM_STATUSES.map(s => <option key={s}>{s}</option>)}</select></div>
        <div className="field"><label htmlFor="cl-dol">Date of loss</label><input id="cl-dol" type="date" name="dateOfLoss" defaultValue={ins.dateOfLoss} /></div>
        <div className="field"><label htmlFor="cl-cause">Cause</label><input id="cl-cause" name="cause" defaultValue={ins.cause} placeholder="Hail, wind…" /></div>
        <div className="field"><label htmlFor="cl-adj">Adjuster</label><input id="cl-adj" name="adjuster" defaultValue={ins.adjuster} /></div>
        <div className="field"><label htmlFor="cl-adjp">Adjuster phone</label><input id="cl-adjp" name="adjPhone" type="tel" defaultValue={ins.adjPhone} /></div>
        <div className="field"><label htmlFor="cl-adje">Adjuster email</label><input id="cl-adje" name="adjEmail" type="email" defaultValue={ins.adjEmail} /></div>
        <div className="field"><label htmlFor="cl-rcv">RCV</label><input id="cl-rcv" name="rcv" inputMode="decimal" defaultValue={ins.rcv || ''} /></div>
        <div className="field"><label htmlFor="cl-acv">ACV</label><input id="cl-acv" name="acv" inputMode="decimal" defaultValue={ins.acv || ''} /></div>
        <div className="field"><label htmlFor="cl-ded">Deductible</label><input id="cl-ded" name="deductible" inputMode="decimal" defaultValue={ins.deductible || ''} /></div>
        <div style={{ gridColumn: '1 / -1' }}><SubmitButton>Save claim</SubmitButton></div>
      </form>
      <h3>Supplements {m.approved > 0 && <span className="muted">· {money(m.approved)} approved</span>}</h3>
      {(ins.supplements ?? []).map(s => (
        <form action={updateSupplement} className="line-item" key={s.id}>
          <input type="hidden" name="id" value={jobId} /><input type="hidden" name="supp_id" value={s.id} />
          <span className="grow"><b>{s.desc}</b></span>
          <span className="num">{money(s.amount)}</span>
          <select name="status" defaultValue={s.status} aria-label="Supplement status">
            {['Pending', 'Approved', 'Denied'].map(x => <option key={x}>{x}</option>)}
          </select>
          <button className="btn small">Save</button>
          <button className="icon-btn" name="remove" value="1" aria-label="Remove supplement">×</button>
        </form>
      ))}
      <form action={addSupplement} className="inline-form add-row">
        <input type="hidden" name="id" value={jobId} />
        <input name="desc" placeholder="Supplement, e.g. Additional ice & water shield" required aria-label="Supplement" className="grow-input" />
        <input name="amount" inputMode="decimal" placeholder="Amount" aria-label="Amount" style={{ width: 110 }} />
        <select name="status" defaultValue="Pending" aria-label="Status">{['Pending', 'Approved', 'Denied'].map(x => <option key={x}>{x}</option>)}</select>
        <SubmitButton className="btn small" pendingText="Adding…">Add</SubmitButton>
      </form>
    </section>
  );
}
