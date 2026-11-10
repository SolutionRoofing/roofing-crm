import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { STAGES } from '@/lib/stages';

export const metadata: Metadata = { title: 'Dashboard' };

export default function DashboardPage() {
  return (
    <>
      <div className="page-head"><h1>Dashboard</h1></div>
      <Suspense fallback={<div className="panel muted">Loading…</div>}>
        <Pipeline />
      </Suspense>
    </>
  );
}

async function Pipeline() {
  const user = await requireUser(['owner', 'office', 'rep']);
  const supabase = await createClient();
  const [{ data: jobs, error }, { data: settings }] = await Promise.all([
    supabase.from('jobs').select('stage'),
    supabase.from('settings').select('company').maybeSingle(),
  ]);
  if (error) return <div className="panel form-error">Could not load jobs: {error.message}</div>;

  const counts = new Map<string, number>();
  for (const j of jobs ?? []) counts.set(j.stage, (counts.get(j.stage) ?? 0) + 1);
  const total = jobs?.length ?? 0;

  return (
    <>
      <p className="notice">
        Welcome, {user.fullName || user.email}. This is the first piece of the shared {settings?.company ?? 'company'} CRM:
        sign-in, team access and crew work orders. The pipeline, jobs and customer screens come next.
      </p>
      <section className="panel">
        <div className="panel-head"><h2>Jobs by stage</h2><span className="muted">{total} total</span></div>
        {total === 0 ? (
          <div className="empty"><strong>No jobs yet</strong><p>Import your prototype backup or add jobs once the pipeline screen is built.</p></div>
        ) : (
          <div className="stage-counts">
            {STAGES.map(s => (
              <div className="tile" key={s.id}>
                <span className="tile-label">{s.name}</span>
                <span className="tile-value">{counts.get(s.id) ?? 0}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
