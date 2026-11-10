import { Suspense } from 'react';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Icon } from '@/components/icon';
import { ConfirmButton, SubmitButton } from '@/components/client';
import { DocSheet, type SheetData } from '@/components/doc-sheet';
import { isAdmin, requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/form';
import { displayStatus, docLabel, docTotals, STATUS_BADGE, type Line } from '@/lib/documents';
import { fmtDateTime, fmtDay, fullName, moneyCents, todayISO } from '@/lib/format';
import { convertToInvoice, deleteDocument, deletePayment, setDocumentStatus, shareDocument } from '../actions';
import { CopyLink, PaymentForm, PrintButton } from '../doc-client';

export const metadata: Metadata = { title: 'Estimate' };

export default function DocumentPage({ params }: PageProps<'/documents/[id]'>) {
  return (
    <Suspense fallback={<div className="panel muted">Loading…</div>}>
      <Doc params={params} />
    </Suspense>
  );
}

type Payment = { id: string; date: string; amount: number; method: string; note: string };

async function Doc({ params }: { params: PageProps<'/documents/[id]'>['params'] }) {
  const me = await requireUser(['owner', 'office', 'rep']);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: d } = await supabase.from('documents')
    .select('*, payments(id, date, amount, method, note), jobs(id, number, name, contact_id)')
    .eq('id', id).maybeSingle();
  if (!d) notFound();
  const job = d.jobs as unknown as { id: string; number: number; name: string; contact_id: string | null };
  const [{ data: contact }, { data: settings }, { data: invoices }] = await Promise.all([
    job.contact_id ? supabase.from('contacts').select('first, last, address, city, st, zip, email, phone').eq('id', job.contact_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('settings').select('company, phone, email, address, license, terms').eq('id', 1).single(),
    d.kind === 'estimate' ? supabase.from('documents').select('id, number, kind').eq('from_id', id) : Promise.resolve({ data: [] }),
  ]);

  const payments = ((d.payments ?? []) as Payment[]).sort((a, b) => a.date.localeCompare(b.date));
  const paid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const items = d.items as Line[];
  const t = docTotals(items, Number(d.tax_rate), paid);
  const today = todayISO();
  const status = displayStatus(d, t.total, paid, today);
  const isInvoice = d.kind === 'invoice';
  const editable = !d.signed_at && d.status !== 'void' && !(d.kind === 'estimate' && ['accepted', 'declined'].includes(d.status));

  const h = await headers();
  // SITE_URL (e.g. https://crm.yourcompany.com) wins once the app is hosted.
  const origin = process.env.SITE_URL?.replace(/\/$/, '') || `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('x-forwarded-host') ?? h.get('host')}`;
  const shareUrl = d.share_token ? `${origin}/e/${d.share_token}` : null;
  const label = docLabel(d);
  const company = settings?.company ?? 'our company';
  const mailto = shareUrl && contact?.email
    ? `mailto:${contact.email}?subject=${encodeURIComponent(`Your ${isInvoice ? 'invoice' : 'estimate'} from ${company}`)}&body=${encodeURIComponent(
        `Hi ${contact.first || 'there'},\n\nHere is your ${isInvoice ? 'invoice' : 'roofing estimate'} (${label}):\n${shareUrl}\n\n${isInvoice ? 'Thank you for your business.' : 'You can review it and sign online when you are ready.'}\n\n${company}${settings?.phone ? `\n${settings.phone}` : ''}`)}`
    : null;

  const sheet: SheetData = {
    kind: d.kind, number: d.number, status: d.status, date: d.date, due_date: d.due_date, items, tax_rate: Number(d.tax_rate),
    notes: d.notes, paid, signed_name: d.signed_name, signed_at: d.signed_at, job: { number: job.number, name: job.name },
    customer: contact, company: settings ?? { company: '', phone: '', email: '', address: '', license: '', terms: '' },
  };

  return (
    <>
      <div className="no-print">
        <Link className="crumb" href={`/jobs/${job.id}#money`}><Icon name="back" size={14} /> Job #{job.number} {job.name}</Link>
        <div className="page-head">
          <div>
            <h1>{label} <span className={`badge ${STATUS_BADGE[status] ?? ''}`}>{status}</span></h1>
            <p className="muted" style={{ marginTop: 4 }}>{fullName(contact)} · {moneyCents(t.total)}{isInvoice && paid > 0 ? ` · ${moneyCents(t.balance)} due` : ''}</p>
          </div>
          <div className="quick" style={{ margin: 0 }}>
            {editable && <Link className="btn" href={`/documents/${id}/edit`}>Edit</Link>}
            <PrintButton />
          </div>
        </div>
      </div>

      <div className="doc-layout">
        <DocSheet d={sheet} signature={d.signature} />

        <aside className="no-print">
          <section className="panel">
            <div className="panel-head"><h2>Send to the customer</h2></div>
            {shareUrl ? (
              <>
                <CopyLink url={shareUrl} />
                <div className="quick">
                  {mailto ? <a className="btn small primary" href={mailto}><Icon name="mail" size={14} /> Email the link</a>
                    : <span className="muted">Add an email to the customer to send it from here.</span>}
                  <a className="btn small" href={shareUrl} target="_blank" rel="noreferrer">Preview</a>
                </div>
                <p className="muted">
                  {isInvoice ? 'The customer can view the invoice.' : 'The customer can review and sign online. Signing moves the job to Sold.'}
                </p>
              </>
            ) : (
              <form action={shareDocument}>
                <input type="hidden" name="id" value={id} />
                <p className="muted" style={{ marginBottom: 10 }}>
                  Make a private link the customer can open on any phone or computer{isInvoice ? '' : ' to review and sign'}. No login needed.
                </p>
                <SubmitButton pendingText="Creating…">Create customer link</SubmitButton>
              </form>
            )}
            <div className="doc-track">
              {d.sent_at && <span>Sent {fmtDateTime(d.sent_at)}</span>}
              {d.viewed_at && <span>Opened by customer {fmtDateTime(d.viewed_at)}</span>}
              {d.signed_at && <span>Signed {fmtDateTime(d.signed_at)}{d.signed_ip ? ` from ${d.signed_ip}` : ''}</span>}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Status</h2></div>
            <div className="quick" style={{ margin: 0 }}>
              {d.status === 'draft' && <StatusButton id={id} status="sent" label="Mark as sent" />}
              {!isInvoice && !d.signed_at && d.status !== 'accepted' && d.status !== 'void' && (
                <StatusButton id={id} status="accepted" label="Mark accepted" confirm="Mark this estimate accepted (for example, signed on paper)? The job moves to Sold." />
              )}
              {!isInvoice && !d.signed_at && ['draft', 'sent'].includes(d.status) && <StatusButton id={id} status="declined" label="Mark declined" />}
              {!isInvoice && d.status !== 'declined' && d.status !== 'void' && (
                <form action={convertToInvoice}><input type="hidden" name="id" value={id} /><SubmitButton className="btn small" pendingText="Creating…">Create invoice from this</SubmitButton></form>
              )}
              {isInvoice && d.status !== 'void' && paid === 0 && (
                <StatusButton id={id} status="void" label="Void invoice" confirm="Void this invoice? The customer link stops working." danger />
              )}
            </div>
            {!!invoices?.length && (
              <p style={{ marginTop: 10 }}>Invoiced as {invoices.map(i => <Link key={i.id} href={`/documents/${i.id}`}>{docLabel(i)} </Link>)}</p>
            )}
          </section>

          {isInvoice && (
            <section className="panel">
              <div className="panel-head"><h2>Payments</h2><span className="muted">{moneyCents(t.paid)} of {moneyCents(t.total)}</span></div>
              {payments.length === 0 && <p className="muted">No payments yet.</p>}
              {payments.map(p => (
                <div className="line-item" key={p.id}>
                  <span className="grow"><b>{moneyCents(p.amount)}</b><small>{fmtDay(p.date)} · {p.method}{p.note ? ` · ${p.note}` : ''}</small></span>
                  {isAdmin(me) && (
                    <form action={deletePayment}>
                      <input type="hidden" name="id" value={p.id} /><input type="hidden" name="document_id" value={id} />
                      <ConfirmButton message="Remove this payment?" className="icon-btn">×</ConfirmButton>
                    </form>
                  )}
                </div>
              ))}
              {t.balance > 0 && d.status !== 'void' && (
                <details className="add-box" open={payments.length === 0}>
                  <summary className="btn small"><Icon name="plus" size={14} /> Record a payment</summary>
                  <PaymentForm documentId={id} balance={t.balance} today={today} />
                </details>
              )}
            </section>
          )}

          {isAdmin(me) && (
            <form action={deleteDocument}>
              <input type="hidden" name="id" value={id} />
              <ConfirmButton message={`Delete ${label}${payments.length ? ' and its payments' : ''}? This cannot be undone.`}>Delete {isInvoice ? 'invoice' : 'estimate'}</ConfirmButton>
            </form>
          )}
        </aside>
      </div>
    </>
  );
}

function StatusButton({ id, status, label, confirm, danger }: { id: string; status: string; label: string; confirm?: string; danger?: boolean }) {
  return (
    <form action={setDocumentStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      {confirm
        ? <ConfirmButton message={confirm} className={danger ? 'btn small danger-ghost' : 'btn small'}>{label}</ConfirmButton>
        : <SubmitButton className="btn small" pendingText="Saving…">{label}</SubmitButton>}
    </form>
  );
}
