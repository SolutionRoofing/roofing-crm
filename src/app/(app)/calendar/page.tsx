import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Icon } from '@/components/icon';
import { EVENT_COLUMNS, EventForm, EventRow, type CalEvent } from '@/components/work';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getPeople } from '@/lib/staff';
import { addDaysISO, fmtDay, todayISO } from '@/lib/format';

export const metadata: Metadata = { title: 'Calendar' };

const DAYS = 14;

export default function CalendarPage({ searchParams }: PageProps<'/calendar'>) {
  return (
    <>
      <div className="page-head"><h1>Calendar</h1></div>
      <Suspense fallback={<div className="panel muted">Loading…</div>}>
        <Agenda searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Agenda({ searchParams }: { searchParams: PageProps<'/calendar'>['searchParams'] }) {
  await requireUser(['owner', 'office', 'rep']);
  const sp = await searchParams;
  const today = todayISO();
  const from = typeof sp.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : today;
  const to = addDaysISO(from, DAYS - 1);
  const who = typeof sp.who === 'string' ? sp.who : '';

  const supabase = await createClient();
  let q = supabase.from('events').select(EVENT_COLUMNS).gte('date', from).lte('date', to).order('date').order('time');
  if (who.startsWith('c:')) q = q.eq('crew_id', who.slice(2));
  else if (who.startsWith('p:')) q = q.eq('assignee_id', who.slice(2));
  const [{ data, error }, { data: wos }, { people, crews }, { data: jobs }] = await Promise.all([
    q,
    supabase.from('work_orders').select('id, job_id, job_number, customer_name, scheduled_date, status, crew_id, crews(name)')
      .gte('scheduled_date', from).lte('scheduled_date', to),
    getPeople(),
    supabase.from('jobs').select('id, number, name').not('stage', 'in', '(paid,lost)').order('number', { ascending: false }).limit(500),
  ]);
  const events = (data ?? []) as unknown as CalEvent[];
  const workOrders = ((wos ?? []) as unknown as { id: string; job_id: string; job_number: number; customer_name: string; scheduled_date: string; status: string; crew_id: string; crews: { name: string } | null }[])
    .filter(w => !who || (who.startsWith('c:') && w.crew_id === who.slice(2)));

  const days = Array.from({ length: DAYS }, (_, i) => addDaysISO(from, i));
  const link = (f: string) => `/calendar?from=${f}${who ? `&who=${encodeURIComponent(who)}` : ''}`;

  return (
    <>
      <div className="filters" style={{ marginBottom: 12 }}>
        <Link className="btn small" href={link(addDaysISO(from, -DAYS))} aria-label="Earlier"><Icon name="back" size={14} /> Earlier</Link>
        <Link className="btn small" href={link(today)}>Today</Link>
        <Link className="btn small" href={link(addDaysISO(from, DAYS))}>Later</Link>
        <span className="muted">{fmtDay(from, { month: 'short', day: 'numeric' })} – {fmtDay(to, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        <span className="spacer" />
        <form className="filters">
          <input type="hidden" name="from" value={from} />
          <select name="who" defaultValue={who} aria-label="Show calendar for">
            <option value="">Everyone</option>
            <optgroup label="Team">{people.map(p => <option key={p.id} value={`p:${p.id}`}>{p.full_name || p.email}</option>)}</optgroup>
            {crews.length > 0 && <optgroup label="Crews">{crews.map(c => <option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}</optgroup>}
          </select>
          <button className="btn small">Show</button>
        </form>
      </div>
      {error && <div className="panel form-error">Could not load the calendar: {error.message}</div>}

      <div className="grid-2 calendar-grid">
        <section className="panel">
          {days.map(d => {
            const dayEvents = events.filter(e => e.date === d);
            const dayWos = workOrders.filter(w => w.scheduled_date === d);
            if (!dayEvents.length && !dayWos.length && d !== today) return null;
            return (
              <div key={d} className="agenda-day">
                <h3 className={d === today ? 'today' : undefined}>{d === today ? 'Today · ' : ''}{fmtDay(d, { weekday: 'long', month: 'short', day: 'numeric' })}</h3>
                {!dayEvents.length && !dayWos.length && <p className="muted">Nothing scheduled.</p>}
                {dayEvents.map(e => <EventRow key={e.id} event={e} people={people} crews={crews} />)}
                {dayWos.map(w => (
                  <div className="line-item" key={w.id}>
                    <span className="when">Install</span>
                    <span className="grow"><b>{w.crews?.name ?? 'Crew'}: job #{w.job_number} {w.customer_name}</b><small>Work order · {w.status.replace('_', ' ')}</small></span>
                    <Link className="btn small hide-sm" href={`/jobs/${w.job_id}`}>Open</Link>
                  </div>
                ))}
              </div>
            );
          })}
          {!events.length && !workOrders.length && <p className="muted" style={{ marginTop: 8 }}>No appointments in these two weeks.</p>}
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Add appointment</h2></div>
          <EventForm jobs={(jobs ?? []).map(j => ({ id: j.id, label: `#${j.number} ${j.name}` }))} people={people} crews={crews} defaultDate={from} />
        </section>
      </div>
    </>
  );
}
