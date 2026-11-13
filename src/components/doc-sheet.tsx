// The printable estimate / invoice. Used on the staff document page and the customer link.
import { docLabel, docTotals, isSection, lineAmount, normalizeLines, type ItemLine, type Line, type SectionLine } from '@/lib/documents';
import { fmtDay, fullAddress, fullName, moneyCents } from '@/lib/format';
import { Logo } from './logo';

export type SheetData = {
  kind: string;
  number: number;
  status: string;
  date: string;
  due_date: string | null;
  items: Line[];
  tax_rate: number;
  notes: string;
  paid: number;
  signed_name: string | null;
  signed_at: string | null;
  job: { number: number; name: string };
  customer: { first?: string; last?: string; address?: string; city?: string; st?: string; zip?: string; email?: string; phone?: string } | null;
  company: { company: string; phone: string; email: string; address: string; license: string; terms: string };
};

export function DocSheet({ d, signature }: { d: SheetData; signature?: string | null }) {
  const items = normalizeLines(d.items);
  const t = docTotals(items, d.tax_rate, d.paid);
  const isInvoice = d.kind === 'invoice';
  return (
    <article className="sheet">
      <header className="sheet-head">
        <div className="sheet-brand">
          <Logo height={88} />
          <div>
          <h2>{d.company.company}</h2>
          <p className="muted">{[d.company.address, d.company.phone, d.company.email].filter(Boolean).join(' · ')}</p>
          {d.company.license && <p className="muted">License #{d.company.license}</p>}
          </div>
        </div>
        <div className="sheet-id">
          <b>{isInvoice ? 'INVOICE' : 'ESTIMATE'}</b>
          <p>{docLabel(d)}</p>
          <p className="muted">{fmtDay(d.date, { month: 'long', day: 'numeric', year: 'numeric' })}</p>
          {isInvoice && d.due_date && <p className="muted">Due {fmtDay(d.due_date, { month: 'long', day: 'numeric', year: 'numeric' })}</p>}
        </div>
      </header>
      <div className="sheet-to">
        <span>{isInvoice ? 'Bill to' : 'Prepared for'}</span>
        <b>{fullName(d.customer)}</b>
        <div>{fullAddress(d.customer)}</div>
        <span style={{ marginTop: 6 }}>Job #{d.job.number} · {d.job.name}</span>
      </div>
      <div className="table-wrap">
        <table className="sheet-table">
          <thead><tr><th>Item</th><th>Description</th><th className="r">Qty</th><th className="r">Price</th><th className="r">Amount</th></tr></thead>
          <tbody>
            {groupLines(items).map((g, gi) => <Group key={gi} g={g} />)}
            {!items.some(l => !isSection(l)) && <tr><td colSpan={5} className="muted">No line items yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <table className="sheet-table sheet-sum">
        <tbody>
          <tr><td>Subtotal</td><td className="r">{moneyCents(t.subtotal)}</td></tr>
          {Number(d.tax_rate) > 0 && <tr><td>Tax ({Number(d.tax_rate)}%)</td><td className="r">{moneyCents(t.tax)}</td></tr>}
          <tr><td><b>Total</b></td><td className="r"><b>{moneyCents(t.total)}</b></td></tr>
          {isInvoice && t.paid > 0 && <tr><td>Paid</td><td className="r">−{moneyCents(t.paid)}</td></tr>}
          {isInvoice && <tr><td><b>Balance due</b></td><td className="r"><b>{moneyCents(t.balance)}</b></td></tr>}
        </tbody>
      </table>
      {d.notes && <div className="sheet-note"><b>Notes</b><p style={{ whiteSpace: 'pre-wrap' }}>{d.notes}</p></div>}
      {!isInvoice && d.company.terms && <div className="sheet-note"><b>Terms</b><p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{d.company.terms}</p></div>}
      {!isInvoice && (
        d.signed_at ? (
          <div className="signed-box">
            {/* eslint-disable-next-line @next/next/no-img-element -- inline data URL, nothing to optimize */}
            {signature && <img src={signature} alt={`Signature of ${d.signed_name}`} className="signature-img" />}
            <p><b>Accepted by {d.signed_name}</b> · signed electronically {new Date(d.signed_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</p>
          </div>
        ) : (
          <div className="sign"><div>Customer signature</div><div>Date</div></div>
        )
      )}
    </article>
  );
}

type LineGroup = { section: SectionLine | null; items: ItemLine[] };

/** Lines before the first section form their own group; each section owns the lines after it. */
function groupLines(lines: Line[]): LineGroup[] {
  const groups: LineGroup[] = [{ section: null, items: [] }];
  for (const l of lines) {
    if (isSection(l)) groups.push({ section: l, items: [] });
    else groups[groups.length - 1].items.push(l);
  }
  return groups.filter(g => g.section || g.items.length);
}

const qtyText = (l: ItemLine) => `${Number(l.qty)}${l.unit ? ` ${l.unit}` : ''}`;

function Group({ g }: { g: LineGroup }) {
  const display = g.section?.display ?? 'items';
  const total = g.items.reduce((s, l) => s + lineAmount(l), 0);
  const showTotal = !!g.section && (display === 'total' || g.section.show_total);
  return (
    <>
      {g.section && (
        <tr className="sheet-section">
          <td colSpan={display === 'total' ? 4 : 5}>{g.section.title || 'Section'}</td>
          {display === 'total' && <td className="r">{moneyCents(total)}</td>}
        </tr>
      )}
      {display !== 'total' && g.items.map((l, i) => (
        <tr key={i}>
          <td className="sheet-item">{l.name}</td>
          <td className="sheet-desc">{l.desc}</td>
          <td className="r">{qtyText(l)}</td>
          <td className="r">{display === 'items' ? moneyCents(l.price) : ''}</td>
          <td className="r">{display === 'items' ? moneyCents(lineAmount(l)) : ''}</td>
        </tr>
      ))}
      {showTotal && display !== 'total' && (
        <tr className="sheet-section-total"><td colSpan={4}>{g.section!.title || 'Section'} total</td><td className="r">{moneyCents(total)}</td></tr>
      )}
    </>
  );
}
