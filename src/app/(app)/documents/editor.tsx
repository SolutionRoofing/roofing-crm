'use client';

import { useActionState, useState } from 'react';
import type { FormState } from '@/app/login/actions';
import { docTotals, standardLines, type CatalogItem, type Line } from '@/lib/documents';
import { moneyCents } from '@/lib/format';
import { saveDocument } from './actions';

type Initial = {
  id?: string; kind: 'estimate' | 'invoice'; job_id: string; items: Line[]; tax_rate: number;
  notes: string; date: string; due_date: string | null;
};

const blank = (): Line => ({ desc: '', qty: 1, unit: 'EA', price: 0 });

export function DocEditor({ initial, catalog, squares }: { initial: Initial; catalog: CatalogItem[]; squares: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveDocument, {});
  const [lines, setLines] = useState<Line[]>(initial.items.length ? initial.items : [blank()]);
  const [taxRate, setTaxRate] = useState(String(initial.tax_rate ?? 0));
  const totals = docTotals(lines, Number(taxRate) || 0);

  const update = (i: number, patch: Partial<Line>) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const remove = (i: number) => setLines(ls => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [blank()]));
  const addCatalog = (id: string) => {
    const c = catalog.find(x => x.id === id);
    if (!c) return;
    const line = { desc: c.description, qty: 1, unit: c.unit, price: Number(c.price) };
    setLines(ls => [...ls.filter(l => l.desc.trim()), line]);
  };
  const fillStandard = () => {
    const std = standardLines(squares, catalog);
    setLines(ls => [...ls.filter(l => l.desc.trim()), ...std]);
  };
  const isInvoice = initial.kind === 'invoice';

  return (
    <form action={action} className="panel">
      <input type="hidden" name="id" value={initial.id ?? ''} />
      <input type="hidden" name="kind" value={initial.kind} />
      <input type="hidden" name="job_id" value={initial.job_id} />
      <input type="hidden" name="items" value={JSON.stringify(lines)} />
      {state.error && <p className="form-error" role="alert" style={{ marginBottom: 12 }}>{state.error}</p>}

      <div className="form-grid">
        <div className="field"><label htmlFor="doc-date">Date</label><input id="doc-date" type="date" name="date" defaultValue={initial.date} /></div>
        {isInvoice && <div className="field"><label htmlFor="doc-due">Due date</label><input id="doc-due" type="date" name="due_date" defaultValue={initial.due_date ?? ''} /></div>}
      </div>

      <div className="dl dl-head" aria-hidden="true"><span>Description</span><span>Qty</span><span>Unit</span><span>Price</span><span>Amount</span><span /></div>
      {lines.map((l, i) => (
        <div className="dl" key={i}>
          <input className="l-desc" value={l.desc} onChange={e => update(i, { desc: e.target.value })} placeholder="Description" aria-label={`Line ${i + 1} description`} />
          <input value={String(l.qty)} inputMode="decimal" onChange={e => update(i, { qty: e.target.value as unknown as number })} aria-label={`Line ${i + 1} quantity`} />
          <input value={l.unit} onChange={e => update(i, { unit: e.target.value })} aria-label={`Line ${i + 1} unit`} />
          <input value={String(l.price)} inputMode="decimal" onChange={e => update(i, { price: e.target.value as unknown as number })} aria-label={`Line ${i + 1} price`} />
          <span className="l-total num">{moneyCents((Number(l.qty) || 0) * (Number(l.price) || 0))}</span>
          <button type="button" className="icon-btn" onClick={() => remove(i)} aria-label={`Remove line ${i + 1}`}>×</button>
        </div>
      ))}

      <div className="doc-add">
        <button type="button" className="btn small" onClick={() => setLines(ls => [...ls, blank()])}>+ Blank line</button>
        {catalog.length > 0 && (
          <select value="" onChange={e => { addCatalog(e.target.value); e.target.value = ''; }} aria-label="Add from price list">
            <option value="">+ Add from price list…</option>
            {catalog.map(c => <option key={c.id} value={c.id}>{c.description} ({moneyCents(c.price)} / {c.unit})</option>)}
          </select>
        )}
        {squares > 0 && catalog.length > 0 && (
          <button type="button" className="btn small" onClick={fillStandard}>Fill standard roof ({squares} SQ)</button>
        )}
      </div>

      <div className="doc-bottom">
        <div className="field">
          <label htmlFor="doc-notes">Notes for the customer</label>
          <textarea id="doc-notes" name="notes" rows={4} defaultValue={initial.notes} placeholder="Shingle color, warranty, what's included…" />
        </div>
        <div>
          <div className="field tax"><label htmlFor="doc-tax">Tax %</label>
            <input id="doc-tax" name="tax_rate" inputMode="decimal" value={taxRate} onChange={e => setTaxRate(e.target.value)} /></div>
          <table className="sheet-table">
            <tbody>
              <tr><td>Subtotal</td><td className="r">{moneyCents(totals.subtotal)}</td></tr>
              <tr><td>Tax</td><td className="r">{moneyCents(totals.tax)}</td></tr>
              <tr><td><b>Total</b></td><td className="r"><b>{moneyCents(totals.total)}</b></td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <button className="btn primary" disabled={pending}>{pending ? 'Saving…' : `Save ${isInvoice ? 'invoice' : 'estimate'}`}</button>
      </div>
    </form>
  );
}
