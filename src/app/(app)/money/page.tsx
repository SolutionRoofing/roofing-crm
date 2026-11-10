import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { displayStatus, docLabel, docTotals, STATUS_BADGE, type Line } from '@/lib/documents';
import { daysSince, fmtDay, money, moneyCents, todayISO } from '@/lib/format';

export const metadata: Metadata = { title: 'Money' };

export default function MoneyPage() {
  return (
    <>
      <div className="page-head"><h1>Money</h1></div>
      <Suspense fallback={<div className="panel muted">Loading…</div>}>
        <Money />
      </Suspense>
    </>
  );
}

type Row = {
  id: string; kind: string; number: number; status: string; date: string; due_date: string | null; items: Line[]; tax_rate: number;
  sent_at: string | null; viewed_at: string | null; signed_at: string | null;
  payments: { amount: number; date: string; method: string }[];
  jobs: { id: string; number: number; name: string } | null;
};

async function Money() {
  await requireUser(['owner', 'office', 'rep']);
  const supabase = await createClient();
  const { data, error } = await supabase.from('documents')
    .select('id, kind, number, status, date, due_date, items, tax_rate, sent_at, viewed_at, signed_at, payments(amount, date, method), jobs(id, number, name)')
    .neq('status', 'void').order('date', { ascending: false }).limit(1000).returns<Row[]>();
  if (error) return <div className="panel form-error">Could not load: {error.message}</div>;

  const today = todayISO();
  const monthStart = `${today.slice(0, 7)}-01`;
  const rows = (data ?? []).map(d => {
    const paid = d.payments.reduce((s, p) => s + Number(p.amount), 0);
    const t = docTotals(d.items, Number(d.tax_rate), paid);
    return { ...d, t, shown: displayStatus(d, t.total, paid, today) };
  });
  const openInvoices = rows.filter(r => r.kind === 'invoice' && r.status !== 'draft' && r.t.balance > 0)
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
  const overdue = openInvoices.filter(r => r.shown === 'overdue');
  const drafts = rows.filter(r => r.status === 'draft');
  const waiting = rows.filter(r => r.kind === 'estimate' && r.status === 'sent');
  const payments = rows.flatMap(r => r.payments.map(p => ({ ...p, doc: r }))).sort((a, b) => b.date.localeCompare(a.date));
  const collectedThisMonth = payments.filter(p => p.date >= monthStart).reduce((s, p) => s + Number(p.amount), 0);
  const sum = (list: typeof rows) => list.reduce((s, r) => s + r.t.balance, 0);

  const DocLine = ({ r, extra }: { r: (typeof rows)[number]; extra?: string }) => (
    <Link className="line-item" href={`/documents/${r.id}`}>
      <span className="grow">
        <b>{docLabel(r)} · Job #{r.jobs?.number} {r.jobs?.name}</b>
        <small>{extra ?? fmtDay(r.date)}</small>
      </span>
      <span className={`badge ${STATUS_BADGE[r.shown] ?? ''}`}>{r.shown}</span>
      <span className="num">{moneyCents(r.kind === 'invoice' ? r.t.balance : r.t.total)}</span>
    </Link>
  );

  return (
    <>
      <div className="tiles">
        <div className="tile"><span className="tile-label">Owed to you</span><span className="tile-value">{money(sum(openInvoices))}</span><span className="tile-sub">{openInvoices.length} open invoices</span></div>
        <div className="tile"><span className="tile-label">Overdue</span><span className={`tile-value${overdue.length ? ' late' : ''}`}>{money(sum(overdue))}</span><span className="tile-sub">{overdue.length} invoices</span></div>
        <div className="tile"><span className="tile-label">Collected this month</span><span className="tile-value">{money(collectedThisMonth)}</span><span className="tile-sub">&nbsp;</span></div>
        <div className="tile"><span className="tile-label">Estimates waiting</span><span className="tile-value">{money(waiting.reduce((s, r) => s + r.t.total, 0))}</span><span className="tile-sub">{waiting.length} sent, not yet signed</span></div>
      </div>
      <div className="grid-2">
        <div>
          <section className="panel">
            <div className="panel-head"><h2>Open invoices</h2></div>
            {openInvoices.length === 0 && <p className="muted">Nothing owed right now.</p>}
            {openInvoices.map(r => <DocLine key={r.id} r={r} extra={r.due_date ? `Due ${fmtDay(r.due_date)}` : 'No due date'} />)}
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Estimates waiting on the customer</h2></div>
            {waiting.length === 0 && <p className="muted">No estimates out.</p>}
            {waiting.map(r => (
              <DocLine key={r.id} r={r} extra={`Sent ${r.sent_at ? `${daysSince(r.sent_at)} days ago` : fmtDay(r.date)} · ${r.viewed_at ? 'Opened' : 'Not opened yet'}`} />
            ))}
          </section>
        </div>
        <div>
          <section className="panel">
            <div className="panel-head"><h2>Recent payments</h2></div>
            {payments.length === 0 && <p className="muted">No payments recorded yet.</p>}
            {payments.slice(0, 15).map((p, i) => (
              <Link className="line-item" key={i} href={`/documents/${p.doc.id}`}>
                <span className="grow"><b>{moneyCents(p.amount)}</b><small>{fmtDay(p.date)} · {p.method} · {docLabel(p.doc)} · Job #{p.doc.jobs?.number}</small></span>
              </Link>
            ))}
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Drafts</h2></div>
            {drafts.length === 0 && <p className="muted">No drafts.</p>}
            {drafts.map(r => <DocLine key={r.id} r={r} />)}
          </section>
        </div>
      </div>
    </>
  );
}
