// Price list import: reads a CSV (a JobNimbus Products & Services export, an ABC Supply price
// sheet, or a spreadsheet saved as CSV) and turns it into price list rows.
// Imports only the estimate math (with its .ts extension) so Node can unit-test it directly.

import { cents, markupFor, priceFor } from './documents.ts';

/** RFC 4180-style CSV: quoted fields, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(c => c.trim() !== '')) rows.push(row);
  return rows;
}

// Column names we recognize (lower-case, spaces/underscores/punctuation ignored).
const ALIASES: Record<string, string[]> = {
  name: ['name', 'product', 'productname', 'item', 'itemname', 'productservice', 'title'],
  description: ['description', 'desc', 'details', 'itemdescription'],
  unit: ['uom', 'unit', 'units', 'unitofmeasure', 'um'],
  mat: ['materialcost', 'matcost', 'mcost', 'cost', 'unitcost', 'yourcost', 'netprice'],
  lab: ['laborcost', 'labourcost', 'lcost'],
  price: ['price', 'unitprice', 'sellprice', 'retailprice', 'customerprice'],
  matPrice: ['materialprice', 'mprice'],
  labPrice: ['laborprice', 'labourprice', 'lprice'],
  markup: ['markup', 'markuppercent', 'markuppct'],
  category: ['category', 'type', 'itemtype', 'group'],
  active: ['active', 'isactive', 'visible', 'visibility', 'status'],
};
const key = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '');

export type ImportRow = { name: string; description: string; unit: string; category: string; material_cost: number; labor_cost: number; markup: number; price: number };
export type ImportResult = { rows: ImportRow[]; skipped: number; columns: string[]; error?: string };

const money = (v: string | undefined) => {
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? cents(n) : 0;
};
const isHidden = (v: string | undefined) => /^(false|no|n|0|hidden|inactive|disabled)$/i.test(String(v ?? '').trim());
const TYPE_LABELS: Record<string, string> = { material: 'Material', labor: 'Labor', 'labor+material': 'Material & Labor', 'material+labor': 'Material & Labor' };

/** Map CSV rows to price list rows. Prices are kept as given; markup is worked out from them. */
export function toPriceRows(text: string, materialTax: number): ImportResult {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], skipped: 0, columns: [], error: 'The file needs a header row and at least one item.' };
  const header = table[0].map(key);
  const col: Record<string, number> = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const i = header.findIndex(h => names.includes(h));
    if (i >= 0) col[field] = i;
  }
  // "Cost" alone means material cost unless a labor column says otherwise; that's the common supplier sheet.
  if (col.name === undefined) return { rows: [], skipped: 0, columns: table[0], error: 'No item name column found. Name the column "Name", "Product" or "Item".' };
  const get = (r: string[], f: string) => (col[f] === undefined ? undefined : r[col[f]]);

  const seen = new Set<string>();
  const rows: ImportRow[] = [];
  let skipped = 0;
  for (const r of table.slice(1, 3001)) {
    const name = String(get(r, 'name') ?? '').trim().slice(0, 200);
    if (!name || isHidden(get(r, 'active')) || seen.has(name.toLowerCase())) { skipped++; continue; }
    seen.add(name.toLowerCase());
    const mat = money(get(r, 'mat'));
    const lab = money(get(r, 'lab'));
    let price = col.price !== undefined ? money(get(r, 'price')) : cents(money(get(r, 'matPrice')) + money(get(r, 'labPrice')));
    let markup = 0;
    const costs = { mat, lab };
    if (mat + lab > 0) {
      if (price > 0) markup = markupFor(price, costs, materialTax);
      else {
        markup = Math.max(0, Number(String(get(r, 'markup') ?? '').replace(/[%\s]/g, '')) || 0);
        price = priceFor({ ...costs, markup }, materialTax);
      }
    }
    const rawType = String(get(r, 'category') ?? '').trim();
    rows.push({
      name,
      description: String(get(r, 'description') ?? '').trim().slice(0, 4000),
      unit: (String(get(r, 'unit') ?? '').trim() || 'EA').slice(0, 12),
      category: (TYPE_LABELS[rawType.toLowerCase()] ?? rawType).slice(0, 60),
      material_cost: mat, labor_cost: lab, markup, price,
    });
  }
  return { rows, skipped, columns: table[0] };
}
