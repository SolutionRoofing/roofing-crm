// Estimates and invoices: types and math shared by the editor, the document page,
// the customer page and the Money page. Mirrors private.document_total in the database.

export type Line = { desc: string; qty: number; unit: string; price: number };
export type DocKind = 'estimate' | 'invoice';
export type DocStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'void';
export type CatalogItem = { id: string; description: string; unit: string; price: number };

export const cents = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function docTotals(items: Line[], taxRate: number, paid = 0) {
  const subtotal = cents(items.reduce((s, l) => s + cents((Number(l.qty) || 0) * (Number(l.price) || 0)), 0));
  const tax = cents(subtotal * (Number(taxRate) || 0) / 100);
  const total = cents(subtotal + tax);
  return { subtotal, tax, total, paid: cents(paid), balance: cents(total - paid) };
}

export const docLabel = (d: { kind: string; number: number }) =>
  `${d.kind === 'invoice' ? 'INV' : 'EST'}-${String(d.number).padStart(2, '0')}`;

/** What to show: invoices derive paid / partly paid / overdue from payments and the due date. */
export function displayStatus(d: { kind: string; status: string; due_date: string | null }, total: number, paid: number, today: string) {
  if (d.kind !== 'invoice' || d.status === 'void') return d.status;
  if (total > 0 && paid >= total) return 'paid';
  if (d.status !== 'draft' && d.due_date && d.due_date < today) return 'overdue';
  if (paid > 0) return 'partly paid';
  return d.status;
}

export const STATUS_BADGE: Record<string, string> = {
  draft: '', sent: 'info', accepted: 'good', declined: 'bad', void: '', paid: 'good', overdue: 'bad', 'partly paid': 'warn',
};

export const PAYMENT_METHODS = ['Check', 'Insurance check', 'Card', 'ACH / bank transfer', 'Cash', 'Financing', 'Other'] as const;

/** The prototype's "Fill standard roof": common lines sized from the job's squares. */
export function standardLines(squares: number, catalog: CatalogItem[]): Line[] {
  const sq = Number(squares) || 0;
  const plan: [string, number][] = [
    ['Tear-off', sq], ['Architectural', sq], ['Synthetic', sq],
    ['Drip edge', Math.round(sq * 6)], ['Ridge vent', Math.round(sq * 1.5)], ['Dumpster', 1],
  ];
  return plan.flatMap(([prefix, qty]) => {
    const c = catalog.find(x => x.description.startsWith(prefix));
    return c ? [{ desc: c.description, qty, unit: c.unit, price: Number(c.price) }] : [];
  });
}

/** Clean up lines coming from a form: drop blanks, coerce numbers, cap sizes. */
export function cleanLines(raw: unknown): Line[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 200).flatMap(r => {
    const l = r as Partial<Line>;
    const desc = String(l.desc ?? '').trim().slice(0, 300);
    if (!desc) return [];
    const qty = Number(l.qty);
    const price = Number(l.price);
    return [{
      desc,
      qty: Number.isFinite(qty) ? Math.round(qty * 1000) / 1000 : 0,
      unit: String(l.unit ?? '').trim().slice(0, 10),
      price: Number.isFinite(price) ? cents(price) : 0,
    }];
  });
}
