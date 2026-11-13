'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ConfirmButton } from '@/components/client';
import { Icon } from '@/components/icon';
import { deleteEvent } from './actions';
import { fmtTime } from '@/lib/format';
import { addDays, layoutLanes, minutes, NOBODY_COLOR, stepDate, viewRange, viewTitle, type CalView } from '@/lib/calendar';

export type CalItem = {
  id: string; kind: 'event' | 'install'; title: string; type: string; date: string; time: string; notes: string;
  who: string; jobId: string | null; job: string; address: string;
};
type Who = { key: string; name: string; color: string };

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_START = 6;   // week view shows 6 AM …
const DAY_END = 21;    // … to 9 PM
const HOUR_PX = 44;
const HIDE_KEY = 'cal-hidden-who';

const dayLabel = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...o });
const href = (view: CalView, date: string) => `/calendar?view=${view}&date=${date}`;
const openAdd = (date: string, time = '') => window.dispatchEvent(new CustomEvent('cal:add', { detail: { date, time } }));
const isPhone = () => window.matchMedia('(max-width: 700px)').matches;
// Which people/crews are hidden, remembered on this device (localStorage; empty if unavailable).
const hideListeners = new Set<() => void>();
const readHidden = () => { try { return localStorage.getItem(HIDE_KEY) ?? '[]'; } catch { return '[]'; } };
const subscribeHidden = (fn: () => void) => { hideListeners.add(fn); return () => { hideListeners.delete(fn); }; };
function writeHidden(list: string[]) {
  try { localStorage.setItem(HIDE_KEY, JSON.stringify(list)); } catch { /* private window */ }
  hideListeners.forEach(fn => fn());
}
const parseHidden = (raw: string) => { try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; } };

const byTime = (a: CalItem, b: CalItem) => (minutes(a.time) ?? -1) - (minutes(b.time) ?? -1) || a.title.localeCompare(b.title);

export function CalendarView({ view, date, today, items, who, me }: {
  view: CalView; date: string; today: string; items: CalItem[]; who: Who[]; me: string;
}) {
  const hiddenRaw = useSyncExternalStore(subscribeHidden, readHidden, () => '[]');
  const hidden = useMemo(() => parseHidden(hiddenRaw), [hiddenRaw]);
  const [detail, setDetail] = useState<CalItem | null>(null);
  const [day, setDay] = useState<string | null>(null);

  const toggle = (k: string) => writeHidden(hidden.includes(k) ? hidden.filter(x => x !== k) : [...hidden, k]);

  const colorOf = useMemo(() => {
    const m = new Map(who.map(w => [w.key, w.color]));
    return (k: string) => m.get(k) ?? NOBODY_COLOR;
  }, [who]);
  const nameOf = (k: string) => who.find(w => w.key === k)?.name ?? (k ? 'Someone' : 'Nobody yet');

  const shown = items.filter(i => !hidden.includes(i.who));
  const byDay = new Map<string, CalItem[]>();
  for (const i of shown) byDay.set(i.date, [...(byDay.get(i.date) ?? []), i]);
  for (const list of byDay.values()) list.sort(byTime);

  // Everyone on the team and every crew, always listed (not just whoever has something this week).
  const allKeys = [...who.map(w => w.key), ''];
  const team = who.filter(w => w.key.startsWith('p:'));
  const crewList = who.filter(w => w.key.startsWith('c:'));
  const countOf = (k: string) => items.filter(i => i.who === k).length;
  const justMe = hidden.length === allKeys.length - 1 && !hidden.includes(me);
  const everyone = hidden.length === 0;
  const hiddenCount = allKeys.filter(k => hidden.includes(k)).length;

  const chip = (i: CalItem, compact = false) => (
    <button
      key={`${i.kind}-${i.id}`}
      type="button"
      className={`cal-chip${i.kind === 'install' ? ' install' : ''}`}
      style={{ '--c': colorOf(i.who) } as React.CSSProperties}
      onClick={e => { e.stopPropagation(); setDetail(i); }}
      title={`${i.time ? `${fmtTime(i.time)} ` : ''}${i.title}${i.job ? ` · ${i.job}` : ''}`}
    >
      {i.time && <span className="t">{fmtTime(i.time).replace(':00', '').replace(' ', '').toLowerCase()}</span>}
      <span className="n">{compact ? i.title : `${i.title}${i.job ? ` · ${i.job.replace(/^#\d+ /, '')}` : ''}`}</span>
    </button>
  );

  return (
    <>
      <div className="cal-bar">
        <div className="filters">
          <Link className="btn small" href={href(view, stepDate(view, date, -1))} aria-label="Earlier"><Icon name="back" size={14} /></Link>
          <Link className="btn small" href={href(view, today)}>Today</Link>
          <Link className="btn small" href={href(view, stepDate(view, date, 1))} aria-label="Later"><span className="flip"><Icon name="back" size={14} /></span></Link>
          <h2 className="cal-title">{viewTitle(view, date)}</h2>
        </div>
        <div className="seg" role="group" aria-label="Calendar view">
          {(['month', 'week', 'list'] as const).map(v => (
            <Link key={v} href={href(v, date)} className={view === v ? 'on' : ''}>{v[0].toUpperCase() + v.slice(1)}</Link>
          ))}
        </div>
      </div>

      <div className="cal-filter" role="group" aria-label="Whose calendar to show">
        <div className="cal-filter-quick">
          <span className="tile-label">Show</span>
          <button type="button" className={everyone ? 'on' : ''} aria-pressed={everyone} onClick={() => writeHidden([])}>Everyone</button>
          {who.some(w => w.key === me) && (
            <button type="button" className={justMe ? 'on' : ''} aria-pressed={justMe} onClick={() => writeHidden(allKeys.filter(k => k !== me))}>Just me</button>
          )}
          {hiddenCount > 0 && !justMe && <span className="muted cal-filter-note">{hiddenCount} hidden</span>}
        </div>
        <div className="cal-legend">
          {[...team, ...crewList, { key: '', name: 'Unassigned', color: NOBODY_COLOR }].map(w => {
            const on = !hidden.includes(w.key);
            const n = countOf(w.key);
            return (
              <button key={w.key || 'none'} type="button" aria-pressed={on} onClick={() => toggle(w.key)}
                title={on ? `Hide ${w.name}` : `Show ${w.name}`} style={{ '--c': w.color } as React.CSSProperties}>
                <span className="check" aria-hidden>{on ? '✓' : ''}</span>
                {w.name}{w.key === me ? ' (you)' : ''}{w.key.startsWith('c:') ? ' · crew' : ''}
                {n > 0 && <span className="n">{n}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {view === 'month' && <Month date={date} today={today} byDay={byDay} chip={chip} onDay={setDay} colorOf={colorOf} />}
      {view === 'week' && <Week date={date} today={today} byDay={byDay} chip={chip} />}
      {view === 'list' && <Agenda date={date} today={today} byDay={byDay} onPick={setDetail} colorOf={colorOf} nameOf={nameOf} />}

      <Modal open={!!detail} onClose={() => setDetail(null)} label="Appointment">
        {detail && <Detail item={detail} color={colorOf(detail.who)} whoName={nameOf(detail.who)} onDone={() => setDetail(null)} />}
      </Modal>
      <Modal open={!!day} onClose={() => setDay(null)} label="Day">
        {day && (
          <>
            <div className="panel-head">
              <h2>{dayLabel(day, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
              <button type="button" className="btn small cta" onClick={() => { setDay(null); openAdd(day); }}><Icon name="plus" size={14} /> Add</button>
            </div>
            {!(byDay.get(day) ?? []).length && <p className="muted">Nothing scheduled.</p>}
            {(byDay.get(day) ?? []).map(i => (
              <button key={`${i.kind}-${i.id}`} type="button" className="line-item cal-row" onClick={() => { setDay(null); setDetail(i); }}>
                <span className="when">{i.time ? fmtTime(i.time) : 'Any time'}</span>
                <span className="dot" style={{ background: colorOf(i.who) }} />
                <span className="grow"><b>{i.title}</b><small>{[nameOf(i.who), i.job].filter(Boolean).join(' · ')}</small></span>
              </button>
            ))}
          </>
        )}
      </Modal>
    </>
  );
}

type ChipFn = (i: CalItem, compact?: boolean) => React.ReactNode;

function Month({ date, today, byDay, chip, onDay, colorOf }: {
  date: string; today: string; byDay: Map<string, CalItem[]>; chip: ChipFn; onDay: (d: string) => void; colorOf: (k: string) => string;
}) {
  const { from } = viewRange('month', date);
  const month = date.slice(0, 7);
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i));
  // Drop a trailing week that is entirely next month.
  const weeks = days.slice(35, 42).every(d => d.slice(0, 7) !== month) ? days.slice(0, 35) : days;
  return (
    <div className="cal-month panel" role="grid" aria-label={viewTitle('month', date)}>
      {DOW.map(d => <div key={d} className="cal-dow" role="columnheader">{d}</div>)}
      {weeks.map(d => {
        const list = byDay.get(d) ?? [];
        const more = list.length - 3;
        return (
          <div
            key={d}
            role="gridcell"
            className={`cal-cell${d.slice(0, 7) !== month ? ' other' : ''}${d === today ? ' today' : ''}${d < today ? ' past' : ''}`}
            onClick={() => (isPhone() ? onDay(d) : openAdd(d))}
            title="Add an appointment on this day"
          >
            <button type="button" className="cal-date" onClick={e => { e.stopPropagation(); onDay(d); }} aria-label={dayLabel(d, { weekday: 'long', month: 'long', day: 'numeric' })}>
              {Number(d.slice(8))}
            </button>
            <div className="cal-chips">
              {list.slice(0, more > 0 ? 2 : 3).map(i => chip(i, true))}
              {more > 0 && <button type="button" className="cal-more" onClick={e => { e.stopPropagation(); onDay(d); }}>+{more + 1} more</button>}
            </div>
            {list.length > 0 && <div className="cal-dots" aria-hidden>{list.slice(0, 4).map(i => <span key={`${i.kind}-${i.id}`} style={{ background: colorOf(i.who) }} className="dot" />)}</div>}
          </div>
        );
      })}
    </div>
  );
}

function Week({ date, today, byDay, chip }: { date: string; today: string; byDay: Map<string, CalItem[]>; chip: ChipFn }) {
  const { from } = viewRange('week', date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);
  const scroller = useRef<HTMLDivElement>(null);
  // Start scrolled to 7 AM.
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = HOUR_PX; }, []);
  return (
    <div className="cal-week panel">
      <div className="cal-week-head">
        <div />
        {days.map(d => (
          <div key={d} className={`cal-wd${d === today ? ' today' : ''}`}>
            <span>{DOW[new Date(`${d}T12:00:00Z`).getUTCDay()]}</span> <b>{Number(d.slice(8))}</b>
          </div>
        ))}
      </div>
      <div className="cal-week-allday">
        <div className="cal-hour-label">All day</div>
        {days.map(d => (
          <div key={d} className="cal-allday-cell" onClick={() => openAdd(d)}>
            {(byDay.get(d) ?? []).filter(i => minutes(i.time) === null).map(i => chip(i, true))}
          </div>
        ))}
      </div>
      <div className="cal-week-body" ref={scroller}>
        <div className="cal-hours">{hours.map(h => <div key={h} className="cal-hour-label" style={{ height: HOUR_PX }}>{fmtTime(`${h}:00`).replace(':00', '')}</div>)}</div>
        {days.map(d => {
          const timed = (byDay.get(d) ?? []).filter(i => minutes(i.time) !== null);
          const starts = timed.map(i => Math.min(Math.max(minutes(i.time)!, DAY_START * 60), DAY_END * 60 - 30));
          const lanes = layoutLanes(starts);
          return (
            <div
              key={d}
              className={`cal-day-col${d === today ? ' today' : ''}`}
              style={{ height: hours.length * HOUR_PX }}
              onClick={e => {
                const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                const h = DAY_START + Math.floor(y / HOUR_PX);
                openAdd(d, `${String(h).padStart(2, '0')}:00`);
              }}
            >
              {timed.map((i, k) => (
                <div
                  key={i.id}
                  className="cal-slot"
                  style={{
                    top: ((starts[k] - DAY_START * 60) / 60) * HOUR_PX + 1,
                    height: HOUR_PX - 3,
                    left: `calc(${(lanes[k].lane / lanes[k].lanes) * 100}% + 2px)`,
                    width: `calc(${100 / lanes[k].lanes}% - 4px)`,
                  }}
                >
                  {chip(i)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Agenda({ date, today, byDay, onPick, colorOf, nameOf }: {
  date: string; today: string; byDay: Map<string, CalItem[]>; onPick: (i: CalItem) => void; colorOf: (k: string) => string; nameOf: (k: string) => string;
}) {
  const days = Array.from({ length: 14 }, (_, i) => addDays(date, i));
  const any = days.some(d => byDay.get(d)?.length);
  return (
    <section className="panel">
      {days.map(d => {
        const list = byDay.get(d) ?? [];
        if (!list.length && d !== today) return null;
        return (
          <div key={d} className="agenda-day">
            <h3 className={d === today ? 'today' : undefined}>
              {d === today ? 'Today · ' : ''}{dayLabel(d, { weekday: 'long', month: 'short', day: 'numeric' })}
              <button type="button" className="link-btn" style={{ marginLeft: 8 }} onClick={() => openAdd(d)}>+ Add</button>
            </h3>
            {!list.length && <p className="muted">Nothing scheduled.</p>}
            {list.map(i => (
              <button key={`${i.kind}-${i.id}`} type="button" className="line-item cal-row" onClick={() => onPick(i)}>
                <span className="when">{i.time ? fmtTime(i.time) : i.kind === 'install' ? 'Install' : 'Any time'}</span>
                <span className="dot" style={{ background: colorOf(i.who) }} />
                <span className="grow">
                  <b>{i.title}</b> <span className="badge">{i.type}</span>
                  <small>{[nameOf(i.who), i.job, i.address].filter(Boolean).join(' · ')}</small>
                </span>
              </button>
            ))}
          </div>
        );
      })}
      {!any && <p className="muted" style={{ marginTop: 8 }}>Nothing scheduled in these two weeks.</p>}
    </section>
  );
}

function Detail({ item, color, whoName, onDone }: { item: CalItem; color: string; whoName: string; onDone: () => void }) {
  const when = `${dayLabel(item.date, { weekday: 'long', month: 'long', day: 'numeric' })}${item.time ? ` · ${fmtTime(item.time)}` : ''}`;
  return (
    <div className="cal-detail" style={{ '--c': color } as React.CSSProperties}>
      <div className="panel-head">
        <h2>{item.title}</h2>
        <span className="badge">{item.type}</span>
      </div>
      <dl>
        <dt>When</dt><dd>{when}</dd>
        <dt>With</dt><dd><span className="dot" /> {whoName}</dd>
        {item.job && <><dt>Job</dt><dd>{item.jobId ? <Link href={`/jobs/${item.jobId}`}>{item.job}</Link> : item.job}</dd></>}
        {item.address && <><dt>Address</dt><dd><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`} target="_blank" rel="noreferrer">{item.address}</a></dd></>}
        {item.notes && <><dt>Notes</dt><dd>{item.notes}</dd></>}
      </dl>
      <div className="cal-detail-actions">
        {item.jobId && <Link className="btn small" href={`/jobs/${item.jobId}`}>Open job</Link>}
        <span className="spacer" />
        {item.kind === 'event' && (
          <form action={deleteEvent} onSubmit={() => setTimeout(onDone, 0)}>
            <input type="hidden" name="id" value={item.id} />
            <input type="hidden" name="job_id" value={item.jobId ?? ''} />
            <ConfirmButton message="Delete this appointment?" className="btn small danger-ghost">Delete</ConfirmButton>
          </form>
        )}
        <button type="button" className="btn small" onClick={onDone}>Close</button>
      </div>
    </div>
  );
}

/** Native <dialog> as a modal; clicking the backdrop or pressing Esc closes it. */
function Modal({ open, onClose, label, children, className = 'modal small' }: {
  open: boolean; onClose: () => void; label: string; children: React.ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={className} aria-label={label} onClose={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}

/** "Add appointment" button plus the pop-up form. Calendar cells open it on a date via a "cal:add" event. */
export function AddEventDialog({ defaultDate, children }: { defaultDate: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const fill = (date: string, time: string) => {
    // The form is server-rendered; set its date and time fields directly.
    setTimeout(() => {
      const f = box.current;
      const d = f?.querySelector<HTMLInputElement>('input[name="date"]');
      const t = f?.querySelector<HTMLInputElement>('input[name="time"]');
      if (d) d.value = date;
      if (t) t.value = time;
      f?.querySelector<HTMLElement>('select, input:not([type=hidden])')?.focus();
    }, 0);
  };
  useEffect(() => {
    const on = (e: Event) => { const { date, time } = (e as CustomEvent<{ date: string; time: string }>).detail; setOpen(true); fill(date, time); };
    window.addEventListener('cal:add', on);
    return () => window.removeEventListener('cal:add', on);
  }, []);
  return (
    <>
      <button type="button" className="btn cta" onClick={() => { setOpen(true); fill(defaultDate, ''); }}><Icon name="plus" size={16} /> Add appointment</button>
      <Modal open={open} onClose={() => setOpen(false)} label="Add appointment" className="modal">
        <div className="panel-head"><h2>Add appointment</h2><button type="button" className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}>×</button></div>
        <div ref={box} onSubmit={() => setTimeout(() => setOpen(false), 0)}>{children}</div>
      </Modal>
    </>
  );
}
