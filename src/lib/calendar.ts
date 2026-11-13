// Calendar helpers shared by the Calendar page and the iCal feed. No server-only imports.

export const CAL_VIEWS = ['month', 'week', 'list'] as const;
export type CalView = (typeof CAL_VIEWS)[number];

/** Distinct colors for people and crews, in a fixed order (never generated). */
export const WHO_COLORS = ['#1f6f4a', '#E4691A', '#1f5b8e', '#7a4fa8', '#0f7c7c', '#b03a2e', '#9a7400', '#b0457a', '#4a5a6a', '#6b7a1f'];
export const NOBODY_COLOR = '#8a8f85';

/** Stable color per person/crew: people first, then crews, each sorted by name. Key is "p:<id>" or "c:<id>". */
export function whoColors(people: { id: string; name: string }[], crews: { id: string; name: string }[]) {
  const keys = [
    ...[...people].sort((a, b) => a.name.localeCompare(b.name)).map(p => `p:${p.id}`),
    ...[...crews].sort((a, b) => a.name.localeCompare(b.name)).map(c => `c:${c.id}`),
  ];
  return Object.fromEntries(keys.map((k, i) => [k, WHO_COLORS[i % WHO_COLORS.length]])) as Record<string, string>;
}

export const whoKey = (e: { assignee_id?: string | null; crew_id?: string | null }) =>
  e.crew_id ? `c:${e.crew_id}` : e.assignee_id ? `p:${e.assignee_id}` : '';

const d = (iso: string) => new Date(`${iso}T12:00:00Z`);
export const addDays = (iso: string, n: number) => { const x = d(iso); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const weekday = (iso: string) => d(iso).getUTCDay(); // 0 = Sunday
export const startOfWeek = (iso: string) => addDays(iso, -weekday(iso));
export const startOfMonth = (iso: string) => `${iso.slice(0, 8)}01`;
export function addMonths(iso: string, n: number) {
  const x = d(startOfMonth(iso));
  x.setUTCMonth(x.getUTCMonth() + n);
  return x.toISOString().slice(0, 10);
}

/** Dates shown for a view around `date`: month = 6 full weeks, week = Sun–Sat, list = 14 days from `date`. */
export function viewRange(view: CalView, date: string) {
  if (view === 'month') { const from = startOfWeek(startOfMonth(date)); return { from, to: addDays(from, 41), days: 42 }; }
  if (view === 'week') { const from = startOfWeek(date); return { from, to: addDays(from, 6), days: 7 }; }
  return { from: date, to: addDays(date, 13), days: 14 };
}

/** Where the Earlier / Later buttons go. */
export function stepDate(view: CalView, date: string, dir: -1 | 1) {
  if (view === 'month') return addMonths(date, dir);
  return addDays(date, (view === 'week' ? 7 : 14) * dir);
}

export function viewTitle(view: CalView, date: string) {
  const f = (iso: string, o: Intl.DateTimeFormatOptions) => d(iso).toLocaleDateString('en-US', { timeZone: 'UTC', ...o });
  if (view === 'month') return f(date, { month: 'long', year: 'numeric' });
  const { from, to } = viewRange(view, date);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const end = sameMonth ? `${Number(to.slice(8))}, ${to.slice(0, 4)}` : f(to, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${f(from, { month: 'short', day: 'numeric' })} – ${end}`;
}

/** "14:30" -> minutes after midnight, or null when there's no time. */
export function minutes(t: string | null | undefined) {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '');
  return m ? Math.min(23 * 60 + 59, Number(m[1]) * 60 + Number(m[2])) : null;
}

/**
 * Side-by-side lanes for timed items that overlap (each assumed to last `dur` minutes).
 * Returns lane index and lane count per item, in input order.
 */
export function layoutLanes(starts: number[], dur = 60) {
  const order = starts.map((s, i) => [s, i] as const).sort((a, b) => a[0] - b[0]);
  const out = starts.map(() => ({ lane: 0, lanes: 1 }));
  let cluster: number[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const close = () => { for (const i of cluster) out[i].lanes = laneEnds.length; cluster = []; laneEnds = []; };
  for (const [s, i] of order) {
    if (s >= clusterEnd) close();
    let lane = laneEnds.findIndex(end => end <= s);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = s + dur;
    out[i].lane = lane;
    cluster.push(i);
    clusterEnd = Math.max(clusterEnd, s + dur);
  }
  close();
  return out;
}

// ---------------------------------------------------------------- iCal feed

export type FeedItem = {
  uid: string; title: string; kind: string; ev_date: string; ev_time: string; notes: string;
  job_number: number | null; job_name: string | null; customer: string; address: string; who: string;
};

/** Escape text for an iCal value and fold lines at 75 octets (RFC 5545). */
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line: string) {
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ch; } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const compact = (iso: string) => iso.replace(/-/g, '');
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}${String(min % 60).padStart(2, '0')}00`;

/** Build an iCal calendar. Timed items last an hour in the business time zone; untimed ones are all-day. */
export function buildIcs(items: FeedItem[], opts: { name: string; tz: string; host: string; now?: Date }) {
  const stamp = (opts.now ?? new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Solution Roofing//CRM//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(opts.name)}`, `X-WR-TIMEZONE:${opts.tz}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
  ];
  for (const it of items) {
    const start = minutes(it.ev_time);
    const job = it.job_number ? `#${it.job_number} ${it.customer || it.job_name || ''}`.trim() : '';
    const summary = [it.title, job && !it.title.includes(job) ? job : ''].filter(Boolean).join(' · ');
    const desc = [it.kind, it.who && `With: ${it.who}`, job && `Job ${job}`, it.notes].filter(Boolean).join('\n');
    lines.push('BEGIN:VEVENT', `UID:${it.uid}@${opts.host}`, `DTSTAMP:${stamp}`);
    if (start === null) {
      lines.push(`DTSTART;VALUE=DATE:${compact(it.ev_date)}`, `DTEND;VALUE=DATE:${compact(addDays(it.ev_date, 1))}`);
    } else {
      const end = Math.min(start + 60, 23 * 60 + 59);
      lines.push(`DTSTART;TZID=${opts.tz}:${compact(it.ev_date)}T${hhmm(start)}`, `DTEND;TZID=${opts.tz}:${compact(it.ev_date)}T${hhmm(end)}`);
    }
    lines.push(`SUMMARY:${esc(summary)}`);
    if (it.address) lines.push(`LOCATION:${esc(it.address)}`);
    if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
