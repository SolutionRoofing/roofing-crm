import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Icon } from '@/components/icon';
import { StageSelect } from '@/components/client';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { STAGES } from '@/lib/stages';
import { JOB_LIST_COLUMNS, type JobRow } from '@/lib/jobs';
import { daysSince, money } from '@/lib/format';
import { changeStage } from '../jobs/actions';

export const metadata: Metadata = { title: 'Pipeline' };

export default function PipelinePage({ searchParams }: PageProps<'/pipeline'>) {
  return (
    <>
      <div className="page-head">
        <h1>Pipeline</h1>
        <Link className="btn primary" href="/jobs/new"><Icon name="plus" size={16} /> New lead</Link>
      </div>
      <Suspense fallback={<div className="panel muted">Loading…</div>}>
        <Board searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Board({ searchParams }: { searchParams: PageProps<'/pipeline'>['searchParams'] }) {
  await requireUser(['owner', 'office', 'rep']);
  const showClosed = (await searchParams).closed === '1';
  const supabase = await createClient();
  let query = supabase.from('job_list').select(JOB_LIST_COLUMNS).order('stage_changed_at', { ascending: true });
  if (!showClosed) query = query.not('stage', 'in', '(paid,lost)');
  const { data, error } = await query.returns<JobRow[]>();
  if (error) return <div className="panel form-error">Could not load the pipeline: {error.message}</div>;

  const stages = STAGES.filter(s => showClosed || s.group !== 'closed');
  const byStage = new Map<string, JobRow[]>(stages.map(s => [s.id, []]));
  for (const j of data ?? []) byStage.get(j.stage)?.push(j);

  return (
    <>
      <div className="filters" style={{ marginBottom: 10 }}>
        <span className="muted">{data?.length ?? 0} {data?.length === 1 ? 'job' : 'jobs'} ·{money((data ?? []).reduce((s, j) => s + Number(j.amount), 0))}</span>
        <span className="spacer" />
        <Link className="btn small" href={showClosed ? '/pipeline' : '/pipeline?closed=1'}>
          {showClosed ? 'Hide paid and lost' : 'Show paid and lost'}
        </Link>
      </div>
      <div className="board">
        {stages.map(s => {
          const jobs = byStage.get(s.id) ?? [];
          return (
            <section className="col" key={s.id} aria-label={s.name}>
              <div className="col-head">
                <h2>{s.name}</h2><span className="muted">{jobs.length}</span>
                <span className="col-sum">{money(jobs.reduce((sum, j) => sum + Number(j.amount), 0))}</span>
              </div>
              <div className="col-body">
                {jobs.length === 0 && <div className="col-empty">No jobs</div>}
                {jobs.map(j => {
                  const days = daysSince(j.stage_changed_at);
                  return (
                    <article className="card link-card" key={j.id}>
                      <Link href={`/jobs/${j.id}`} className="card-link">
                        <div className="card-top"><b>{j.customer_name || j.name}</b>{j.type === 'Insurance' && <span className="pill">Claim</span>}</div>
                        <div className="card-addr">{j.address || j.name}</div>
                        <div className="card-foot">
                          <span className="num">{money(j.amount)}</span>
                          <span className={days >= 14 ? 'late' : undefined}>{days}d{j.rep_name ? ` · ${j.rep_name.split(' ')[0]}` : ''}</span>
                        </div>
                      </Link>
                      <StageSelect action={changeStage} jobId={j.id} stage={j.stage} compact />
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
