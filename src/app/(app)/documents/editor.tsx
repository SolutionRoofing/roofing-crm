'use client';

import Link from 'next/link';
import { useActionState, useEffect, useId, useMemo, useRef, useState, useTransition } from 'react';
import type { FormState } from '@/app/login/actions';
import {
  applyMargin, costTotals, docTotals, isItem, isSection, lineAmount, markupFor, priceFor, sectionTotals, SECTION_DISPLAYS, unitCost,
  type CatalogItem, type EstimateTemplate, type ItemLine, type Line, type SectionLine,
} from '@/lib/documents';
import { moneyCents } from '@/lib/format';
import { saveDocument, saveEstimateTemplate } from './actions';

type Initial = {
  id?: string; kind: 'estimate' | 'invoice'; job_id: string; items: Line[]; tax_rate: number; material_tax_rate: number;
  notes: string; internal_notes: string; date: string; due_date: string | null;
};
type Row = { k: number; l: Line };

let nextKey = 1;
const row = (l: Line): Row => ({ k: nextKey++, l });
const blankItem = (): ItemLine => ({ name: '', desc: '', unit: 'EA', qty: 1, mat: 0, lab: 0, markup: 0, price: 0 });
const blankSection = (): SectionLine => ({ type: 'section', title: '', display: 'items', show_total: true });
const isBlank = (l: Line) => isItem(l) && !l.name.trim() && !l.desc.trim() && !l.price && !l.mat && !l.lab;
const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

/**
 * JobNimbus-style estimate builder: same columns in the same order (item, description, unit, qty,
 * material/labor cost, markup, price, amount), sections, item search from the price list, and a
 * cost / profit / margin summary the customer never sees.
 */
export function DocEditor({ initial, catalog, templates, canSaveProducts, cancelHref }: {
  initial: Initial; catalog: CatalogItem[]; templates: EstimateTemplate[]; canSaveProducts: boolean; cancelHref: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveDocument, {});
  const [rows, setRows] = useState<Row[]>(() => (initial.items.length ? initial.items : [blankItem()]).map(row));
  const [taxRate, setTaxRate] = useState(initial.tax_rate ?? 0);
  const [matTax, setMatTax] = useState(initial.material_tax_rate ?? 0);
  const [notes, setNotes] = useState(initial.notes);
  const [marginGoal, setMarginGoal] = useState('');
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const isInvoice = initial.kind === 'invoice';

  const lines = useMemo(() => rows.map(r => r.l), [rows]);
  const totals = docTotals(lines, taxRate);
  const costs = costTotals(lines, matTax);
  const secTotals = sectionTotals(lines);

  const setLine = (k: number, next: Line) => setRows(rs => rs.map(r => (r.k === k ? { ...r, l: next } : r)));
  const remove = (k: number) => setRows(rs => {
    const left = rs.filter(r => r.k !== k);
    return left.length ? left : [row(blankItem())];
  });
  const move = (from: number, to: number) => setRows(rs => {
    if (to < 0 || to >= rs.length || from === to) return rs;
    const next = [...rs];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    return next;
  });
  const add = (l: Line) => setRows(rs => [...rs.filter(r => !isBlank(r.l)), row(l)]);
  const addTemplate = (id: string) => {
    const t = templates.find(x => x.id === id);
    if (!t) return;
    setRows(rs => [...rs.filter(r => !isBlank(r.l)), ...t.items.map(row)]);
    if (!notes.trim() && t.notes) setNotes(t.notes);
  };
  const setMargin = () => {
    const m = Number(marginGoal);
    if (!Number.isFinite(m) || m < 0 || m >= 95) return;
    const repriced = applyMargin(lines, m, matTax);
    setRows(rs => rs.map((r, i) => ({ ...r, l: repriced[i] })));
  };

  return (
    <form action={action} className="panel est-editor">
      <input type="hidden" name="id" value={initial.id ?? ''} />
      <input type="hidden" name="kind" value={initial.kind} />
      <input type="hidden" name="job_id" value={initial.job_id} />
      <input type="hidden" name="items" value={JSON.stringify(lines)} />
      <input type="hidden" name="tax_rate" value={taxRate} />
      <input type="hidden" name="material_tax_rate" value={matTax} />
      {state.error && <p className="form-error" role="alert" style={{ marginBottom: 12 }}>{state.error}</p>}

      <div className="est-top">
        <div className="field"><label htmlFor="doc-date">{isInvoice ? 'Invoice date' : 'Estimate date'}</label><input id="doc-date" type="date" name="date" defaultValue={initial.date} /></div>
        {isInvoice && <div className="field"><label htmlFor="doc-due">Due date</label><input id="doc-due" type="date" name="due_date" defaultValue={initial.due_date ?? ''} /></div>}
        {templates.length > 0 && (
          <div className="field">
            <label htmlFor="doc-template">Start from template</label>
            <select id="doc-template" value="" onChange={e => addTemplate(e.target.value)}>
              <option value="">Pick a template…</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="est-table" role="table" aria-label="Line items">
        <div className="est-row est-head" role="row">
          <span /><span>Item name</span><span>Description</span><span>UoM</span><span className="r">Qty</span>
          <span className="r" title="Material cost (before the tax you pay) over labor cost, per unit">M/L cost</span>
          <span className="r">Markup %</span><span className="r">Price</span><span className="r">Amount</span><span />
        </div>
        {rows.map((r, i) => (
          <div
            key={r.k}
            role="row"
            className={`est-row${isSection(r.l) ? ' est-section' : ''}${dragFrom === i ? ' dragging' : ''}`}
            onDragOver={e => { if (dragFrom !== null) e.preventDefault(); }}
            onDrop={e => { e.preventDefault(); if (dragFrom !== null) move(dragFrom, i); setDragFrom(null); }}
          >
            <span className="est-grip" draggable aria-hidden="true" title="Drag to reorder"
              onDragStart={e => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }}
              onDragEnd={() => setDragFrom(null)}>⋮⋮</span>
            {isSection(r.l)
              ? <SectionRow l={r.l} total={secTotals.get(i) ?? 0} onChange={l => setLine(r.k, l)} />
              : <ItemRow l={r.l} index={i} matTax={matTax} catalog={catalog} canSaveProducts={canSaveProducts} onChange={l => setLine(r.k, l)} />}
            <span className="est-row-tools">
              <button type="button" className="icon-btn est-move" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move line ${i + 1} up`}>↑</button>
              <button type="button" className="icon-btn est-move" onClick={() => move(i, i + 1)} disabled={i === rows.length - 1} aria-label={`Move line ${i + 1} down`}>↓</button>
              <button type="button" className="icon-btn" onClick={() => remove(r.k)} aria-label={`Remove line ${i + 1}`}>×</button>
            </span>
          </div>
        ))}
      </div>

      <div className="est-add">
        <button type="button" className="btn small" onClick={() => add(blankItem())}>+ Add item</button>
        <button type="button" className="btn small" onClick={() => add(blankSection())}>+ Add section</button>
      </div>

      <div className="est-bottom">
        <div className="est-notes">
          <div className="field">
            <label htmlFor="doc-notes">Customer note</label>
            <textarea id="doc-notes" name="notes" rows={4} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Shingle color, warranty, what's included…" />
          </div>
          <div className="field">
            <label htmlFor="doc-internal">Internal note <span className="muted">(staff only)</span></label>
            <textarea id="doc-internal" name="internal_notes" rows={3} defaultValue={initial.internal_notes} placeholder="Supplier quote #, crew notes, anything the customer shouldn't see" />
          </div>
        </div>

        <div className="est-summary">
          <table className="sheet-table">
            <tbody>
              <tr><td>Material cost</td><td className="r">{moneyCents(costs.material)}</td></tr>
              <tr>
                <td><label htmlFor="doc-mattax">Material tax</label> <PctInput id="doc-mattax" value={matTax} onChange={setMatTax} /></td>
                <td className="r">{moneyCents(costs.materialTax)}</td>
              </tr>
              <tr><td>Labor cost</td><td className="r">{moneyCents(costs.labor)}</td></tr>
              <tr className="est-strong"><td>Total cost</td><td className="r">{moneyCents(costs.cost)}</td></tr>
              <tr><td>Markup</td><td className="r">{moneyCents(costs.profit)} <small>{pct(costs.markup)}</small></td></tr>
              <tr className="est-strong"><td>Subtotal</td><td className="r">{moneyCents(totals.subtotal)}</td></tr>
              <tr>
                <td><label htmlFor="doc-tax">Sales tax to customer</label> <PctInput id="doc-tax" value={taxRate} onChange={setTaxRate} /></td>
                <td className="r">{moneyCents(totals.tax)}</td>
              </tr>
              <tr className="est-total"><td>Total</td><td className="r">{moneyCents(totals.total)}</td></tr>
            </tbody>
          </table>
          <div className={`est-profit${costs.profit < 0 ? ' bad' : ''}`}>
            <div><span className="eyebrow">Total profit</span><b>{moneyCents(costs.profit)}</b></div>
            <div><span className="eyebrow">Profit margin</span><b>{pct(costs.margin)}</b></div>
          </div>
          {costs.cost > 0 && (
            <div className="est-margin">
              <label htmlFor="doc-margin">Set margin to</label>
              <input id="doc-margin" inputMode="decimal" value={marginGoal} onChange={e => setMarginGoal(e.target.value)} placeholder={String(costs.margin)} />
              <span>%</span>
              <button type="button" className="btn small" onClick={setMargin} disabled={!marginGoal}>Apply</button>
            </div>
          )}
          <p className="muted est-hint">Costs, markup, profit and the internal note never show on the customer&apos;s copy.</p>
        </div>
      </div>

      <div className="est-actions">
        <Link className="btn" href={cancelHref}>Cancel</Link>
        <span className="spacer" />
        {!isInvoice && <SaveTemplate lines={lines} notes={notes} />}
        <button className="btn primary" disabled={pending}>{pending ? 'Saving…' : `Save ${isInvoice ? 'invoice' : 'estimate'}`}</button>
      </div>
    </form>
  );
}

function ItemRow({ l, index, matTax, catalog, canSaveProducts, onChange }: {
  l: ItemLine; index: number; matTax: number; catalog: CatalogItem[]; canSaveProducts: boolean; onChange: (l: ItemLine) => void;
}) {
  const n = index + 1;
  const hasCost = unitCost(l, matTax) > 0;
  // Like JobNimbus: changing a cost keeps the markup and moves the price; changing the price moves the markup.
  const setCost = (patch: Partial<ItemLine>) => {
    const next = { ...l, ...patch };
    onChange(unitCost(next, matTax) > 0 ? { ...next, price: priceFor(next, matTax) } : next);
  };
  const pick = (c: CatalogItem) => {
    const base: ItemLine = {
      name: c.name, desc: c.description, unit: c.unit, qty: l.qty || 1,
      mat: Number(c.material_cost) || 0, lab: Number(c.labor_cost) || 0, markup: Number(c.markup) || 0, price: Number(c.price) || 0, pid: c.id,
    };
    onChange(unitCost(base, matTax) > 0 ? { ...base, price: priceFor(base, matTax) } : base);
  };
  return (
    <>
      <span className="est-c-name">
        <ItemSearch value={l.name} line={n} catalog={catalog} canSaveProducts={canSaveProducts} isNew={!!l.save}
          onType={name => onChange({ ...l, name, pid: undefined, save: false })} onPick={pick} onNew={name => onChange({ ...l, name, pid: undefined, save: true })} />
      </span>
      <span className="est-c-desc">
        <textarea value={l.desc} rows={2} onChange={e => onChange({ ...l, desc: e.target.value })} placeholder="Description" aria-label={`Line ${n} description`} />
      </span>
      <span className="est-c-unit"><input value={l.unit} onChange={e => onChange({ ...l, unit: e.target.value })} aria-label={`Line ${n} unit`} /></span>
      <span className="est-c-qty"><NumInput value={l.qty} onChange={qty => onChange({ ...l, qty })} label={`Line ${n} quantity`} decimals={3} /></span>
      <span className="est-c-cost">
        <span className="est-ml"><i>M</i><NumInput value={l.mat} onChange={mat => setCost({ mat })} label={`Line ${n} material cost per unit`} money /></span>
        <span className="est-ml"><i>L</i><NumInput value={l.lab} onChange={lab => setCost({ lab })} label={`Line ${n} labor cost per unit`} money /></span>
      </span>
      <span className="est-c-markup">
        <NumInput value={l.markup} onChange={markup => onChange({ ...l, markup, price: hasCost ? priceFor({ ...l, markup }, matTax) : l.price })}
          label={`Line ${n} markup percent`} decimals={2} disabled={!hasCost} />
      </span>
      <span className="est-c-price">
        <NumInput value={l.price} onChange={price => onChange({ ...l, price, markup: hasCost ? markupFor(price, l, matTax) : l.markup })} label={`Line ${n} price per unit`} money />
      </span>
      <span className="est-c-amount num">{moneyCents(lineAmount(l))}</span>
    </>
  );
}

function SectionRow({ l, total, onChange }: { l: SectionLine; total: number; onChange: (l: SectionLine) => void }) {
  return (
    <span className="est-c-section">
      <input className="est-section-title" value={l.title} onChange={e => onChange({ ...l, title: e.target.value })} placeholder="Section title, e.g. Roofing" aria-label="Section title" />
      <select value={l.display} onChange={e => onChange({ ...l, display: e.target.value as SectionLine['display'] })} aria-label="What the customer sees for this section">
        {SECTION_DISPLAYS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
      </select>
      <label className="inline-check"><input type="checkbox" checked={l.show_total} onChange={e => onChange({ ...l, show_total: e.target.checked })} /> Show section total</label>
      <span className="spacer" />
      <b className="num">{moneyCents(total)}</b>
    </span>
  );
}

/** Item name box: type to search the price list; pick a match or add it as a new product. */
function ItemSearch({ value, line, catalog, canSaveProducts, isNew, onType, onPick, onNew }: {
  value: string; line: number; catalog: CatalogItem[]; canSaveProducts: boolean; isNew: boolean;
  onType: (v: string) => void; onPick: (c: CatalogItem) => void; onNew: (name: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = value.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return catalog.slice(0, 12);
    const words = q.split(/\s+/);
    return catalog.filter(c => {
      const hay = `${c.name} ${c.category} ${c.description}`.toLowerCase();
      return words.every(w => hay.includes(w));
    }).slice(0, 12);
  }, [q, catalog]);
  const showNew = canSaveProducts && !!q && !catalog.some(c => c.name.trim().toLowerCase() === q);
  const options: ({ kind: 'new' } | { kind: 'item'; c: CatalogItem })[] = [
    ...(showNew ? [{ kind: 'new' as const }] : []), ...matches.map(c => ({ kind: 'item' as const, c })),
  ];
  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    if (o.kind === 'new') onNew(value.trim()); else onPick(o.c);
    setOpen(false);
  };
  const listOpen = open && options.length > 0;

  return (
    <span className="est-search">
      <input
        value={value}
        onChange={e => { onType(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (!listOpen) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(options.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
          else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
          else if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="Item name"
        aria-label={`Line ${line} item name`}
        role="combobox"
        aria-expanded={listOpen}
        aria-controls={id}
        aria-autocomplete="list"
        autoComplete="off"
      />
      {isNew && <small className="est-new-tag">New product: saved to the price list with the estimate</small>}
      {listOpen && (
        <ul className="est-list" id={id} role="listbox">
          {options.map((o, i) => (
            <li key={o.kind === 'new' ? 'new' : o.c.id} role="option" aria-selected={i === active} className={i === active ? 'on' : ''}
              onMouseDown={e => { e.preventDefault(); choose(i); }} onMouseEnter={() => setActive(i)}>
              {o.kind === 'new'
                ? <span className="est-list-new">Add new product: <b>{value.trim()}</b></span>
                : <><span>{o.c.name}{o.c.category ? <small>{o.c.category}</small> : null}</span><span className="num muted">{moneyCents(o.c.price)} / {o.c.unit}</span></>}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

/** Number box that lets people type freely ("1.", "") and reports a number. */
function NumInput({ value, onChange, label, money, decimals = 2, disabled }: {
  value: number; onChange: (n: number) => void; label: string; money?: boolean; decimals?: number; disabled?: boolean;
}) {
  const fmt = (n: number) => (money ? (Number(n) || 0).toFixed(2) : String(Math.round((Number(n) || 0) * 10 ** decimals) / 10 ** decimals));
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);
  // Keep the box in step when the number changes elsewhere (markup moves the price, etc.).
  useEffect(() => {
    if (!focused.current) setText(fmt(value)); // mirror outside changes (markup moving the price) into the box
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      value={text}
      inputMode="decimal"
      aria-label={label}
      disabled={disabled}
      onFocus={e => { focused.current = true; e.target.select(); }}
      onBlur={() => { focused.current = false; setText(fmt(value)); }}
      onChange={e => {
        const t = e.target.value.replace(/[$,\s]/g, '');
        setText(e.target.value);
        const n = Number(t);
        if (t === '' || t === '-' || t === '.') onChange(0);
        else if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

function PctInput({ id, value, onChange }: { id: string; value: number; onChange: (n: number) => void }) {
  return (
    <span className="est-pct">
      <input id={id} inputMode="decimal" defaultValue={String(value)} onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(n); }} />%
    </span>
  );
}

/** "Save as template": stores the current lines and customer note under a name, without saving the estimate. */
function SaveTemplate({ lines, notes }: { lines: Line[]; notes: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<FormState>({});
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <span className="est-template-save">
        {msg.ok && <small className="good-text" role="status">{msg.ok}</small>}
        <button type="button" className="btn" onClick={() => { setOpen(true); setMsg({}); }}>Save as template</button>
      </span>
    );
  }
  return (
    <span className="est-template-save">
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Template name, e.g. Full replacement" aria-label="Template name" autoFocus
        onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }} />
      <button type="button" className="btn small" disabled={pending || !name.trim()}
        onClick={() => start(async () => {
          const r = await saveEstimateTemplate(name, lines, notes);
          setMsg(r);
          if (r.ok) { setName(''); setOpen(false); }
        })}>{pending ? 'Saving…' : 'Save template'}</button>
      <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Cancel">×</button>
      {msg.error && <small className="late">{msg.error}</small>}
    </span>
  );
}
