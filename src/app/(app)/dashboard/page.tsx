import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Icon } from '@/components/icon';
import { EVENT_COLUMNS, EventRow, TASK_COLUMNS, TaskRow, type CalEvent, type Task } from '@/components/work';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { STAGES } from '@/lib/stages';
import { getPeople } from '@/lib/staff';
import { JOB_LIST_COLUMNS, StageBadge, type JobRow } from '@/lib/jobs';
import { addDaysISO, daysSince, fmtDay, money, todayISO } from '@/lib/format';

export const metadata: Metadata = { title: 'Dashboard' };

export default function DashboardPage() {
  return (
    <Suspense fallback={<><div className="page-head"><h1>Dashboard</h1></div><div className="panel muted">Loading…</div></>}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const me = await requireUser(['owner', 'office', 'rep']);
  const supabase = await createClient();
  const today = todayISO();
  const monthStart = `${today.slice(0, 7)}-01`;
  const [{ data: jobsData, error }, { data: tasksData }, { data: eventsData }, { people, crews }] = await Promise.all([
    supabase.from('job_list').select(JOB_LIST_COLUMNS).returns<JobRow[]>(),
    supabase.from('tasks').select(TASK_COLUMNS).eq('done', false).eq('assignee_id', me.id).order('due', { nullsFirst: false }).limit(8),
    supabase.from('events').select(EVENT_COLUMNS).gte('date', today).lte('date', addDaysISO(today, 6)).order('date').order('time').limit(12),
    getPeople(),
  ]);
  if (error) return <div className="panel form-error">Could not load jobs: {error.message}</div>;

  const jobs = jobsData ?? [];
  const tasks = (tasksData ?? []) as unknown as Task[];
  const events = (eventsData ?? []) as unknown as CalEvent[];
  const group = (id: string) => STAGES.find(s => s.id === id)?.group;
  const open = jobs.filter(j => group(j.stage) !== 'closed');
  const sum = (list: JobRow[]) => list.reduce((s, j) => s + Number(j.amount), 0);
  const soldThisMonth = jobs.filter(j => j.sold_at && j.sold_at.slice(0, 10) >= monthStart && j.stage !== 'lost');
  const newLeads = jobs.filter(j => j.created_at.slice(0, 10) >= monthStart);
  const stuck = open.filter(j => daysSince(j.stage_changed_at) >= 14).sort((a, b) => a.stage_changed_at.localeCompare(b.stage_changed_at)).slice(0, 6);
  const counts = new Map<string, number>();
  for (const j of open) counts.set(j.stage, (counts.get(j.stage) ?? 0) + 1);
  const maxCount = Math.max(1, ...counts.values());

  return (
    <>
      <div className="page-head">
        <div><p className="eyebrow">{fmtDay(today, { weekday: 'long', month: 'long', day: 'numeric' })}</p><h1 style={{ marginTop: 4 }}>Dashboard</h1></div>
        <Link className="btn cta" href="/jobs/new"><Icon name="plus" size={16} /> New lead</Link>
      </div>
      <div className="tiles">
        <Link className="tile" href="/jobs?stage=open"><span className="tile-label">Open pipeline</span><span className="tile-value">{money(sum(open))}</span><span className="tile-sub">{open.length} open jobs</span></Link>
        <div className="tile"><span className="tile-label">Sold this month</span><span className="tile-value">{money(sum(soldThisMonth))}</span><span className="tile-sub">{soldThisMonth.length} jobs</span></div>
        <div className="tile"><span className="tile-label">New leads this month</span><span className="tile-value">{newLeads.length}</span><span className="tile-sub">&nbsp;</span></div>
        <Link className="tile" href="/tasks"><span className="tile-label">Your open tasks</span><span className="tile-value">{tasks.length}{tasks.length === 8 ? '+' : ''}</span><span className="tile-sub">{tasks.filter(t => t.due && t.due < today).length} overdue</span></Link>
      </div>
      <div className="grid-2">
        <div>
          <section className="panel">
            <div className="panel-head"><h2>Next 7 days</h2><Link href="/calendar">Calendar</Link></div>
            {events.length === 0 && <p className="muted">Nothing scheduled.</p>}
            {events.map(e => <EventRow key={e.id} event={e} people={people} crews={crews} showDate />)}
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Your tasks</h2><Link href="/tasks">All tasks</Link></div>
            {tasks.length === 0 && <p className="muted">Nothing assigned to you.</p>}
            {tasks.map(t => <TaskRow key={t.id} task={t} people={people} today={today} />)}
          </section>
        </div>
        <div>
          <section className="panel">
            <div className="panel-head"><h2>Open jobs by stage</h2><Link href="/pipeline">Pipeline</Link></div>
            {open.length === 0 ? <p className="muted">No open jobs yet.</p> : (
              <div className="bars">
                {STAGES.filter(s => s.group !== 'closed').map(s => (
                  <div className="bar-row" key={s.id}>
                    <span className="bar-label">{s.name}</span>
                    <span className="bar-track"><span className="bar-fill" style={{ width: `${((counts.get(s.id) ?? 0) / maxCount) * 100}%` }} /></span>
                    <span className="bar-val">{counts.get(s.id) ?? 0}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Stuck for 2+ weeks</h2></div>
            {stuck.length === 0 && <p className="muted">Nothing stuck. Nice.</p>}
            {stuck.map(j => (
              <Link className="line-item" key={j.id} href={`/jobs/${j.id}`}>
                <span className="grow"><b>#{j.number} {j.customer_name || j.name}</b><small>{daysSince(j.stage_changed_at)} days · {j.rep_name || 'Unassigned'}</small></span>
                <StageBadge stage={j.stage} />
              </Link>
            ))}
          </section>
        </div>
      </div>
    </>
  );
}
