import { Suspense } from 'react';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { EventForm } from '@/components/work';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getPeople, personName } from '@/lib/staff';
import { todayISO } from '@/lib/format';
import { CAL_VIEWS, viewRange, whoColors, type CalView } from '@/lib/calendar';
import { AddEventDialog, CalendarView, type CalItem } from './calendar-view';
import { CalendarLinks } from './calendar-links';

export const metadata: Metadata = { title: 'Calendar' };

export default function CalendarPage({ searchParams }: PageProps<'/calendar'>) {
  return (
    <Suspense fallback={<><div className="page-head"><h1>Calendar</h1></div><div className="panel muted">Loading…</div></>}>
      <Calendar searchParams={searchParams} />
    </Suspense>
  );
}

type EvRow = {
  id: string; title: string; type: string; job_id: string | null; assignee_id: string | null; crew_id: string | null;
  date: string; time: string; notes: string;
  jobs: { number: number; name: string; contacts: { first: string; last: string; address: string; city: string } | null } | null;
};
type WoRow = {
  id: string; job_id: string; job_number: number; customer_name: string; scheduled_date: string; status: string; crew_id: string;
  jobs: { contacts: { address: string; city: string } | null } | null;
};

async function Calendar({ searchParams }: { searchParams: PageProps<'/calendar'>['searchParams'] }) {
  const me = await requireUser(['owner', 'office', 'rep']);
  const sp = await searchParams;
  const today = todayISO();
  const view: CalView = CAL_VIEWS.includes(sp.view as CalView) ? (sp.view as CalView) : 'month';
  const date = typeof sp.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const { from, to } = viewRange(view, date);

  const supabase = await createClient();
  const [{ data: evs, error }, { data: wos }, { people, crews }, { data: jobs }, { data: mine }] = await Promise.all([
    supabase.from('events')
      .select('id, title, type, job_id, assignee_id, crew_id, date, time, notes, jobs(number, name, contacts(first, last, address, city))')
      .gte('date', from).lte('date', to).order('date').order('time'),
    supabase.from('work_orders')
      .select('id, job_id, job_number, customer_name, scheduled_date, status, crew_id, jobs(contacts(address, city))')
      .gte('scheduled_date', from).lte('scheduled_date', to),
    getPeople(),
    supabase.from('jobs').select('id, number, name').not('stage', 'in', '(paid,lost)').order('number', { ascending: false }).limit(500),
    supabase.from('profiles').select('calendar_token').eq('id', me.id).maybeSingle(),
  ]);

  const names: Record<string, string> = {
    ...Object.fromEntries(people.map(p => [`p:${p.id}`, personName(p)])),
    ...Object.fromEntries(crews.map(c => [`c:${c.id}`, c.name])),
  };
  const colors = whoColors(people.map(p => ({ id: p.id, name: personName(p) })), crews);
  const addr = (c: { address: string; city: string } | null | undefined) => [c?.address, c?.city].filter(Boolean).join(', ');

  const items: CalItem[] = [
    ...((evs ?? []) as unknown as EvRow[]).map(e => {
      const c = e.jobs?.contacts;
      return {
        id: e.id, kind: 'event' as const, title: e.title, type: e.type, date: e.date, time: e.time, notes: e.notes,
        who: e.crew_id ? `c:${e.crew_id}` : e.assignee_id ? `p:${e.assignee_id}` : '',
        jobId: e.job_id, job: e.jobs ? `#${e.jobs.number} ${c ? `${c.first} ${c.last}`.trim() || e.jobs.name : e.jobs.name}` : '',
        address: addr(c),
      };
    }),
    ...((wos ?? []) as unknown as WoRow[]).map(w => ({
      id: w.id, kind: 'install' as const, title: `${names[`c:${w.crew_id}`] ?? 'Crew'}: install`, type: 'Install',
      date: w.scheduled_date, time: '', notes: `Work order · ${w.status.replace('_', ' ')}`,
      who: `c:${w.crew_id}`, jobId: w.job_id, job: `#${w.job_number} ${w.customer_name}`, address: addr(w.jobs?.contacts),
    })),
  ];

  const who = [
    ...people.map(p => ({ key: `p:${p.id}`, name: personName(p), color: colors[`p:${p.id}`] })),
    ...crews.map(c => ({ key: `c:${c.id}`, name: c.name, color: colors[`c:${c.id}`] })),
  ];

  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`;
  const token = (mine as { calendar_token: string | null } | null)?.calendar_token ?? null;

  return (
    <>
      <div className="page-head">
        <h1>Calendar</h1>
        <div className="filters">
          {token && <CalendarLinks mine={`${origin}/api/calendar/${token}.ics`} everyone={`${origin}/api/calendar/${token}.ics?all=1`} />}
          <AddEventDialog defaultDate={date < today && view !== 'list' ? today : date}>
            <EventForm jobs={(jobs ?? []).map(j => ({ id: j.id, label: `#${j.number} ${j.name}` }))} people={people} crews={crews} defaultDate={today} />
          </AddEventDialog>
        </div>
      </div>
      {error && <div className="panel form-error">Could not load the calendar: {error.message}</div>}
      <CalendarView view={view} date={date} today={today} items={items} who={who} me={`p:${me.id}`} />
    </>
  );
}
