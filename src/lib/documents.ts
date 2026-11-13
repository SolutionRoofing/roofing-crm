// Estimates and invoices: types and math shared by the editor, the document page,
// the customer page and the Money page. The customer total mirrors private.document_total.
//
// Lines work like JobNimbus: an item has a name, a long description, unit, quantity, a material
// cost and a labor cost per unit, a markup and a price. Price = unit cost × (1 + markup%).
// Unit cost counts the sales tax the company pays on materials, so markup and margin are real.

export type ItemLine = {
  type?: 'item';
  name: string;
  desc: string;
  unit: string;
  qty: number;
  /** Material cost per unit, before the tax the company pays on it. */
  mat: number;
  /** Labor cost per unit. */
  lab: number;
  /** Markup % on unit cost. */
  markup: number;
  /** Price per unit the customer sees. */
  price: number;
  /** Price list item this line came from. */
  pid?: string;
  /** Editor only: add this line to the price list when the estimate is saved. */
  save?: boolean;
};
export type SectionDisplay = 'items' | 'no_prices' | 'total' | 'hidden';
export type SectionLine = { type: 'section'; title: string; display: SectionDisplay; show_total: boolean };
export type Line = ItemLine | SectionLine;

export type DocKind = 'estimate' | 'invoice';
export type DocStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'void';
export type CatalogItem = {
  id: string; name: string; description: string; unit: string; price: number;
  material_cost: number; labor_cost: number; markup: number; category: string;
};
/** One choice on the estimate (Good / Better / Best, Repair…). */
export type EstOption = { name: string; items: Line[] };
/** Extra the customer can tick when signing. */
export type Upgrade = { name: string; desc: string; price: number };
/** Question the customer answers when signing, e.g. Shingle color. */
export type Selection = { label: string; value: string };
export type EstimateTemplate = {
  id: string; name: string; items: Line[]; notes: string; options: EstOption[]; upgrades: Upgrade[]; selections: Selection[];
};

export const SECTION_DISPLAYS: { value: SectionDisplay; label: string }[] = [
  { value: 'items', label: 'Show line items' },
  { value: 'no_prices', label: 'Show items, hide prices' },
  { value: 'total', label: 'Show section total only' },
  { value: 'hidden', label: 'Hide (add into the package line)' },
];

export const cents = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0);

export const isSection = (l: Line): l is SectionLine => l.type === 'section';
export const isItem = (l: Line): l is ItemLine => l.type !== 'section';

/** Older lines only had { desc, qty, unit, price }: the short text was the item name. */
export function normalizeLine(raw: unknown): Line {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.type === 'section') {
    const display = SECTION_DISPLAYS.some(d => d.value === r.display) ? (r.display as SectionDisplay) : 'items';
    return { type: 'section', title: String(r.title ?? ''), display, show_total: r.show_total !== false };
  }
  const hasName = typeof r.name === 'string';
  return {
    name: String(hasName ? r.name : r.desc ?? ''),
    desc: hasName ? String(r.desc ?? '') : '',
    unit: String(r.unit ?? ''),
    qty: num(r.qty), mat: num(r.mat), lab: num(r.lab), markup: num(r.markup), price: num(r.price),
    ...(typeof r.pid === 'string' ? { pid: r.pid } : {}),
  };
}
export const normalizeLines = (raw: unknown): Line[] => (Array.isArray(raw) ? raw.map(normalizeLine) : []);

/** Cost of one unit: material plus the tax paid on it, plus labor. */
export const unitCost = (l: Pick<ItemLine, 'mat' | 'lab'>, materialTax: number) =>
  num(l.mat) * (1 + num(materialTax) / 100) + num(l.lab);

/** Price per unit from cost and markup. */
export const priceFor = (l: Pick<ItemLine, 'mat' | 'lab' | 'markup'>, materialTax: number) =>
  cents(unitCost(l, materialTax) * (1 + num(l.markup) / 100));

/** Markup % that a typed-in price implies (0 when the line has no cost). */
export function markupFor(price: number, l: Pick<ItemLine, 'mat' | 'lab'>, materialTax: number) {
  const cost = unitCost(l, materialTax);
  return cost > 0 ? Math.round((num(price) / cost - 1) * 10000) / 100 : 0;
}

export const lineAmount = (l: Line) => (isItem(l) ? cents(num(l.qty) * num(l.price)) : 0);

/** What the customer pays. Sections carry no money. */
export function docTotals(items: Line[], taxRate: number, paid = 0) {
  const subtotal = cents(items.reduce((s, l) => s + lineAmount(l), 0));
  const tax = cents(subtotal * num(taxRate) / 100);
  const total = cents(subtotal + tax);
  return { subtotal, tax, total, paid: cents(paid), balance: cents(total - paid) };
}

/** Staff-only numbers: what the job costs and what it makes. Profit is figured before customer sales tax. */
export function costTotals(items: Line[], materialTax: number) {
  let material = 0, labor = 0, subtotal = 0;
  for (const l of items) {
    if (!isItem(l)) continue;
    material += num(l.qty) * num(l.mat);
    labor += num(l.qty) * num(l.lab);
    subtotal += lineAmount(l);
  }
  material = cents(material);
  labor = cents(labor);
  subtotal = cents(subtotal);
  const materialTaxAmt = cents(material * num(materialTax) / 100);
  const cost = cents(material + materialTaxAmt + labor);
  const profit = cents(subtotal - cost);
  return {
    material, materialTax: materialTaxAmt, labor, cost, subtotal, profit,
    margin: subtotal > 0 ? Math.round(profit / subtotal * 1000) / 10 : 0,
    markup: cost > 0 ? Math.round(profit / cost * 1000) / 10 : 0,
  };
}

/**
 * Re-price the lines that have a cost so the whole estimate lands on a target profit margin %.
 * Lines with no cost (a permit, a flat-price extra) keep their price and count fully as profit,
 * so the markup on costed lines is: margin / (1 − margin) − (no-cost revenue ÷ cost).
 * Never prices below cost: if the no-cost lines alone beat the target, markup stops at 0.
 */
export function applyMargin(items: Line[], marginPct: number, materialTax: number): Line[] {
  const m = Math.min(95, Math.max(0, num(marginPct))) / 100;
  let cost = 0, fixedRevenue = 0;
  for (const l of items) {
    if (!isItem(l)) continue;
    const c = unitCost(l, materialTax);
    if (c > 0) cost += num(l.qty) * c; else fixedRevenue += lineAmount(l);
  }
  if (cost <= 0) return items;
  const k = Math.max(0, m / (1 - m) - fixedRevenue / cost);
  const markup = Math.round(k * 10000) / 100;
  return items.map(l => (isItem(l) && unitCost(l, materialTax) > 0 ? { ...l, markup, price: priceFor({ ...l, markup }, materialTax) } : l));
}

/** Sum of the item lines under each section (keyed by the section's index). */
export function sectionTotals(items: Line[]) {
  const totals = new Map<number, number>();
  let current = -1;
  items.forEach((l, i) => {
    if (isSection(l)) { current = i; totals.set(i, 0); }
    else if (current >= 0) totals.set(current, cents((totals.get(current) ?? 0) + lineAmount(l)));
  });
  return totals;
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

const clip = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const money = (v: unknown, max = 10_000_000) => Math.min(max, Math.max(-max, cents(num(v))));

/** Clean up lines coming from a form: drop empty lines, coerce numbers, cap sizes. */
export function cleanLines(raw: unknown): Line[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 300).flatMap((r): Line[] => {
    const l = (r ?? {}) as Record<string, unknown>;
    if (l.type === 'section') {
      const s = normalizeLine(l) as SectionLine;
      return [{ ...s, title: clip(s.title, 120) }];
    }
    const name = clip(l.name ?? l.desc, 200);
    const desc = l.name !== undefined ? clip(l.desc, 4000) : '';
    if (!name && !desc) return [];
    return [{
      name: name || 'Item', desc,
      unit: clip(l.unit, 12),
      qty: round3(Math.min(1_000_000, Math.max(-1_000_000, num(l.qty)))),
      mat: money(l.mat), lab: money(l.lab),
      markup: Math.round(Math.min(10_000, Math.max(-100, num(l.markup))) * 100) / 100,
      price: money(l.price),
      ...(typeof l.pid === 'string' && /^[0-9a-f-]{36}$/i.test(l.pid) ? { pid: l.pid } : {}),
      ...(l.save === true ? { save: true } : {}),
    }];
  });
}

const clipStr = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);

export function normalizeOptions(raw: unknown): EstOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((o, i) => ({ name: clipStr((o as EstOption)?.name, 60) || `Option ${i + 1}`, items: normalizeLines((o as EstOption)?.items) }));
}
export function cleanOptions(raw: unknown): EstOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 6).map((o, i) => ({ name: clipStr((o as EstOption)?.name, 60) || `Option ${i + 1}`, items: cleanLines((o as EstOption)?.items) }));
}
export function cleanUpgrades(raw: unknown): Upgrade[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 20).flatMap(u => {
    const r = (u ?? {}) as Record<string, unknown>;
    const name = clipStr(r.name, 160);
    return name ? [{ name, desc: clipStr(r.desc, 1000), price: Math.max(0, cents(num(r.price))) }] : [];
  });
}
export function cleanSelections(raw: unknown): Selection[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 6).flatMap(q => {
    const r = (q ?? {}) as Record<string, unknown>;
    const label = clipStr(r.label, 80);
    return label ? [{ label, value: clipStr(r.value, 200) }] : [];
  });
}

/**
 * The lines as the customer sees them: sections marked "hidden" disappear and their total is added
 * to the first visible line (the package line). Mirrors private.customer_items in the database.
 */
export function customerLines(items: Line[]): Line[] {
  const out: Line[] = [];
  let hidden = false;
  let hiddenTotal = 0;
  let first = -1;
  for (const l of items) {
    if (isSection(l)) { hidden = l.display === 'hidden'; if (!hidden) out.push(l); continue; }
    if (hidden) { hiddenTotal += lineAmount(l); continue; }
    out.push(l);
    if (first < 0) first = out.length - 1;
  }
  hiddenTotal = cents(hiddenTotal);
  if (!hiddenTotal) return out;
  if (first < 0) return [...out, { name: 'Roofing project', desc: '', unit: 'EA', qty: 1, mat: 0, lab: 0, markup: 0, price: hiddenTotal }];
  const pkg = out[first] as ItemLine;
  const qty = num(pkg.qty) || 1;
  out[first] = { ...pkg, qty, price: cents((num(pkg.price) * qty + hiddenTotal) / qty) };
  return out;
}
