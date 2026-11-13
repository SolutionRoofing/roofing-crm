const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdCents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export const money = (n: number | string | null | undefined) => usd.format(Number(n) || 0);
export const moneyCents = (n: number | string | null | undefined) => usdCents.format(Number(n) || 0);

/** "2026-11-09" -> "Mon, Nov 9" (dates are stored without a time zone). */
export function fmtDay(d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', opts) : '';
}

export function fmtDateTime(ts: string | null | undefined) {
  return ts ? new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
}

/** "13:30" -> "1:30 PM" */
export function fmtTime(t: string | null | undefined) {
  if (!t || !/^\d{1,2}:\d{2}/.test(t)) return t ?? '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export const daysSince = (ts: string | null | undefined) =>
  ts ? Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)) : 0;

/** Today's date as YYYY-MM-DD in the business's local time (America/New_York by default — Cincinnati). */
export function todayISO(tz = process.env.BUSINESS_TIMEZONE || 'America/New_York') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDaysISO(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type ContactLike = { first?: string | null; last?: string | null; address?: string | null; city?: string | null; st?: string | null; zip?: string | null };
export const fullName = (c: ContactLike | null | undefined) => (c ? `${c.first ?? ''} ${c.last ?? ''}`.trim() || 'No name' : 'No customer');
export const fullAddress = (c: ContactLike | null | undefined) =>
  c ? [c.address, c.city, [c.st, c.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
export const mapHref = (address: string) => `https://maps.google.com/?q=${encodeURIComponent(address)}`;
