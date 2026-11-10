import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { TASK_COLUMNS, TaskForm, TaskRow, type Task } from '@/components/work';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getPeople } from '@/lib/staff';
import { todayISO } from '@/lib/format';

export const metadata: Metadata = { title: 'Tasks' };

export default function TasksPage({ searchParams }: PageProps<'/tasks'>) {
  return (
    <>
      <div className="page-head"><h1>Tasks</h1></div>
      <Suspense fallback={<div className="panel muted">Loading…</div>}>
        <Tasks searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Tasks({ searchParams }: { searchParams: PageProps<'/tasks'>['searchParams'] }) {
  const me = await requireUser(['owner', 'office', 'rep']);
  const sp = await searchParams;
  const view = sp.view === 'all' ? 'all' : 'mine';
  const show = sp.show === 'done' ? 'done' : 'open';

  const supabase = await createClient();
  let q = supabase.from('tasks').select(TASK_COLUMNS).eq('done', show === 'done').limit(300);
  q = show === 'done' ? q.order('created_at', { ascending: false }) : q.order('due', { nullsFirst: false });
  if (view === 'mine') q = q.eq('assignee_id', me.id);
  const [{ data, error }, { people }, { data: jobs }] = await Promise.all([
    q,
    getPeople(),
    supabase.from('jobs').select('id, number, name').not('stage', 'in', '(paid,lost)').order('number', { ascending: false }).limit(500),
  ]);
  const tasks = (data ?? []) as unknown as Task[];
  const today = todayISO();
  const href = (v: string, s: string) => `/tasks?view=${v}&show=${s}`;

  return (
    <>
      <div className="filters" style={{ marginBottom: 12 }}>
        <div className="seg" role="group" aria-label="Whose tasks">
          <Link className={view === 'mine' ? 'on' : ''} href={href('mine', show)}>Mine</Link>
          <Link className={view === 'all' ? 'on' : ''} href={href('all', show)}>Everyone</Link>
        </div>
        <div className="seg" role="group" aria-label="Open or done">
          <Link className={show === 'open' ? 'on' : ''} href={href(view, 'open')}>Open</Link>
          <Link className={show === 'done' ? 'on' : ''} href={href(view, 'done')}>Done</Link>
        </div>
      </div>
      <section className="panel">
        <TaskForm jobs={(jobs ?? []).map(j => ({ id: j.id, label: `#${j.number} ${j.name}` }))} people={people} defaultAssignee={me.id} />
        {error && <p className="form-error">Could not load tasks: {error.message}</p>}
        {!error && tasks.length === 0 && <div className="empty"><strong>{show === 'open' ? 'Nothing to do' : 'No finished tasks'}</strong></div>}
        {tasks.map(t => <TaskRow key={t.id} task={t} people={people} today={today} />)}
      </section>
    </>
  );
}
