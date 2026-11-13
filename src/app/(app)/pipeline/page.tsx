import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Icon } from '@/components/icon';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { STAGES } from '@/lib/stages';
import { JOB_LIST_COLUMNS, type JobRow } from '@/lib/jobs';
import { money } from '@/lib/format';
import { PipelineBoard } from './board';

export const metadata: Metadata = { title: 'Pipeline' };

export default function PipelinePage({ searchParams }: PageProps<'/pipeline'>) {
  return (
    <>
      <div className="page-head">
        <h1>Pipeline</h1>
        <Link className="btn cta" href="/jobs/new"><Icon name="plus" size={16} /> New lead</Link>
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

  return (
    <>
      <div className="filters" style={{ marginBottom: 10 }}>
        <span className="muted">{data?.length ?? 0} {data?.length === 1 ? 'job' : 'jobs'} ·{money((data ?? []).reduce((s, j) => s + Number(j.amount), 0))}</span>
        <span className="spacer" />
        <Link className="btn small" href={showClosed ? '/pipeline' : '/pipeline?closed=1'}>
          {showClosed ? 'Hide paid and lost' : 'Show paid and lost'}
        </Link>
      </div>
      <PipelineBoard stages={stages.map(s => ({ id: s.id, name: s.name }))} jobs={data ?? []} />
    </>
  );
}
