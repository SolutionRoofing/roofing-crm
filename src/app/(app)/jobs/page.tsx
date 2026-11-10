import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Icon } from '@/components/icon';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { STAGES } from '@/lib/stages';
import { JOB_LIST_COLUMNS, StageBadge, type JobRow } from '@/lib/jobs';
import { getPeople, personName } from '@/lib/staff';
import { money } from '@/lib/format';

export const metadata: Metadata = { title: 'Jobs' };

export default function JobsPage({ searchParams }: PageProps<'/jobs'>) {
  return (
    <>
      <div className="page-head">
        <h1>Jobs</h1>
        <Link className="btn primary" href="/jobs/new"><Icon name="plus" size={16} /> New lead</Link>
      </div>
      <Suspense fallback={<div className="panel muted">Loading…</div>}>
        <JobList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

async function JobList({ searchParams }: { searchParams: PageProps<'/jobs'>['searchParams'] }) {
  await requireUser(['owner', 'office', 'rep']);
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const stage = one(sp.stage);
  const rep = one(sp.rep);

  const supabase = await createClient();
  let query = supabase.from('job_list').select(JOB_LIST_COLUMNS).order('number', { ascending: false }).limit(300);
  if (stage === 'open') query = query.not('stage', 'in', '(paid,lost)');
  else if (stage) query = query.eq('stage', stage);
  if (rep) query = query.eq('rep_id', rep);
  if (q) {
    const safe = q.replace(/[%,()*"\\]/g, ' ').trim();
    const asNumber = Number(safe);
    const like = `"%${safe}%"`;
    query = query.or([
      `name.ilike.${like}`, `customer_name.ilike.${like}`, `address.ilike.${like}`, `phone.ilike.${like}`,
      ...(Number.isInteger(asNumber) && asNumber > 0 ? [`number.eq.${asNumber}`] : []),
    ].join(','));
  }
  const [{ data, error }, { people }] = await Promise.all([query.returns<JobRow[]>(), getPeople()]);

  return (
    <>
      <form className="filters" style={{ marginBottom: 12 }}>
        <input type="search" name="q" defaultValue={q} placeholder="Search name, address, phone or job #" aria-label="Search jobs" style={{ minWidth: 240 }} />
        <select name="stage" defaultValue={stage} aria-label="Stage">
          <option value="">All stages</option>
          <option value="open">Open jobs</option>
          {STAGES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select name="rep" defaultValue={rep} aria-label="Sales rep">
          <option value="">All reps</option>
          {people.map(p => <option key={p.id} value={p.id}>{personName(p)}</option>)}
        </select>
        <button className="btn">Filter</button>
        {(q || stage || rep) && <Link href="/jobs" className="btn danger-ghost">Clear</Link>}
      </form>
      {error && <div className="panel form-error">Could not load jobs: {error.message}</div>}
      {!error && !data?.length && (
        <div className="panel empty"><strong>{q || stage || rep ? 'No jobs match' : 'No jobs yet'}</strong><p>Add a lead to get started.</p></div>
      )}
      {!!data?.length && (
        <div className="panel flush table-wrap">
          <table className="table">
            <thead><tr><th>Job</th><th>Customer</th><th>Stage</th><th className="hide-sm">Rep</th><th style={{ textAlign: 'right' }}>Value</th></tr></thead>
            <tbody>
              {data.map(j => (
                <tr key={j.id}>
                  <td><Link href={`/jobs/${j.id}`}><b>#{j.number}</b> {j.name}</Link>{j.type === 'Insurance' && <> <span className="pill">Claim</span></>}</td>
                  <td>{j.customer_name}<small>{j.address}</small></td>
                  <td><StageBadge stage={j.stage} /></td>
                  <td className="hide-sm">{j.rep_name || <span className="muted">Unassigned</span>}</td>
                  <td className="num" style={{ textAlign: 'right' }}>{money(j.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
