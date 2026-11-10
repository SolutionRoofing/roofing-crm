import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { updateWorkOrder } from './actions';

export const metadata: Metadata = { title: 'Work orders' };

type ScopeItem = { desc: string; qty: number | string; unit: string };
type WorkOrder = {
  id: string;
  status: 'assigned' | 'in_progress' | 'done';
  scheduled_date: string | null;
  job_number: number;
  customer_name: string;
  site_address: string;
  site_phone: string;
  roof_type: string;
  squares: number;
  pitch: string;
  scope: ScopeItem[];
  materials: string;
  access_notes: string;
  crew_notes: string;
  crews: { name: string } | null;
};

const STATUS_LABEL = { assigned: 'Not started', in_progress: 'In progress', done: 'Done' } as const;
const STATUS_BADGE = { assigned: '', in_progress: 'info', done: 'good' } as const;

export default function WorkOrdersPage() {
  return (
    <Suspense fallback={<><div className="page-head"><h1>Work orders</h1></div><div className="panel muted">Loading…</div></>}>
      <WorkOrders />
    </Suspense>
  );
}

const fmtDate = (d: string | null) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : 'Not scheduled';

async function WorkOrders() {
  const user = await requireUser();
  const supabase = await createClient();
  // Every column here is price-free by design; crews can't read anything else.
  const { data, error } = await supabase
    .from('work_orders')
    .select('id, status, scheduled_date, job_number, customer_name, site_address, site_phone, roof_type, squares, pitch, scope, materials, access_notes, crew_notes, crews(name)')
    .order('scheduled_date', { ascending: true, nullsFirst: false })
    .returns<WorkOrder[]>();
  const STATUS_ORDER = { in_progress: 0, assigned: 1, done: 2 };
  data?.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  const isCrew = user.role === 'crew';
  return (
    <>
      <div className="page-head"><h1>{isCrew ? 'My work' : 'Work orders'}</h1></div>
      {error && <div className="panel form-error">Could not load work orders: {error.message}</div>}
      {!error && !data?.length && (
        <div className="panel empty">
          <strong>No work orders yet</strong>
          <p>{isCrew ? 'Jobs the office assigns to your crew will show up here.' : 'Create one from a job once the job screens are built.'}</p>
        </div>
      )}
      {data?.map(wo => (
        <article className="wo-card" key={wo.id}>
          <header>
            <div>
              <h2>Job {wo.job_number} · {wo.customer_name || 'Customer'}</h2>
              <div className="wo-meta">
                <span>{fmtDate(wo.scheduled_date)}</span>
                {!isCrew && wo.crews && <span>{wo.crews.name}</span>}
              </div>
            </div>
            <span className={`badge ${STATUS_BADGE[wo.status]}`}>{STATUS_LABEL[wo.status]}</span>
          </header>
          <div className="wo-meta">
            {wo.site_address && (
              <a href={`https://maps.google.com/?q=${encodeURIComponent(wo.site_address)}`} target="_blank" rel="noreferrer">{wo.site_address}</a>
            )}
            {wo.site_phone && <a href={`tel:${wo.site_phone.replace(/[^\d+]/g, '')}`}>{wo.site_phone}</a>}
            <span>{[wo.roof_type, wo.squares ? `${wo.squares} SQ` : '', wo.pitch && `${wo.pitch} pitch`].filter(Boolean).join(' · ')}</span>
          </div>
          {wo.scope.length > 0 && (
            <ul>{wo.scope.map((s, i) => <li key={i}>{s.desc}{s.qty ? ` · ${s.qty} ${s.unit}` : ''}</li>)}</ul>
          )}
          {wo.materials && <p style={{ marginTop: 8 }}><b>Materials:</b> {wo.materials}</p>}
          {wo.access_notes && <p style={{ marginTop: 4 }}><b>Site notes:</b> {wo.access_notes}</p>}
          <form action={updateWorkOrder} className="field" style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={wo.id} />
            <label htmlFor={`notes-${wo.id}`}>Crew notes</label>
            <textarea id={`notes-${wo.id}`} name="crew_notes" rows={2} defaultValue={wo.crew_notes} />
            <div className="quick">
              {wo.status === 'assigned' && <button className="btn primary" name="status" value="in_progress">Start job</button>}
              {wo.status === 'in_progress' && <button className="btn primary" name="status" value="done">Mark done</button>}
              <button className="btn" name="status" value={wo.status}>Save notes</button>
            </div>
          </form>
        </article>
      ))}
    </>
  );
}
