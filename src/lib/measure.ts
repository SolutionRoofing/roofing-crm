// Roof measurements and quantity formulas.
//
// A job's measurements (from GAF QuickMeasure, HOVER/Roofr or typed in) feed simple formulas on
// price list items, e.g. starter = ceil((eaves + rakes) / 116). The formula language is tiny and
// safe — numbers, measurement names, + - * / ( ), and ceil/floor/round/min/max — no eval().

export type Measurements = {
  area_sqft: number;     // total roof area, square feet
  waste_pct: number;     // suggested waste % from the report
  pitch: number;         // predominant pitch, rise per 12 (6 = 6/12)
  low_sq: number;        // low-slope / flat area, squares (flat to 2/12) — included in area_sqft
  steep_sq: number;      // area 10/12 and steeper, squares — included in area_sqft
  eaves: number;         // linear feet
  rakes: number;
  ridges: number;
  hips: number;
  valleys: number;
  step: number;          // step flashing, LF
  wall: number;          // headwall / roof-to-wall flashing, LF
  pipes: number;         // pipe jacks, each
  layers: number;        // existing layers to tear off
  source: string;        // e.g. "GAF QuickMeasure"
};

export const MEASURE_FIELDS: { key: keyof Measurements; label: string; unit: string; hint?: string }[] = [
  { key: 'area_sqft', label: 'Total roof area', unit: 'sq ft' },
  { key: 'waste_pct', label: 'Suggested waste', unit: '%', hint: 'From the report' },
  { key: 'pitch', label: 'Predominant pitch', unit: '/12' },
  { key: 'low_sq', label: 'Low slope (flat–2/12)', unit: 'sq', hint: 'Part of the total' },
  { key: 'steep_sq', label: 'Steep (10/12+)', unit: 'sq', hint: 'Part of the total' },
  { key: 'eaves', label: 'Eaves', unit: 'LF' },
  { key: 'rakes', label: 'Rakes', unit: 'LF' },
  { key: 'ridges', label: 'Ridges', unit: 'LF' },
  { key: 'hips', label: 'Hips', unit: 'LF' },
  { key: 'valleys', label: 'Valleys', unit: 'LF' },
  { key: 'step', label: 'Step flashing', unit: 'LF' },
  { key: 'wall', label: 'Wall / headwall flashing', unit: 'LF' },
  { key: 'pipes', label: 'Pipe jacks', unit: 'ea' },
  { key: 'layers', label: 'Layers to tear off', unit: '' },
];

export const EMPTY_MEASUREMENTS: Measurements = {
  area_sqft: 0, waste_pct: 0, pitch: 0, low_sq: 0, steep_sq: 0, eaves: 0, rakes: 0, ridges: 0, hips: 0,
  valleys: 0, step: 0, wall: 0, pipes: 0, layers: 1, source: '',
};

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);

export function cleanMeasurements(raw: unknown): Measurements {
  const r = (raw ?? {}) as Record<string, unknown>;
  const out = { ...EMPTY_MEASUREMENTS };
  for (const f of MEASURE_FIELDS) (out[f.key] as number) = Math.round(n(r[f.key]) * 100) / 100;
  out.layers = r.layers === undefined || r.layers === '' ? 1 : Math.min(5, Math.round(n(r.layers)));
  out.source = String(r.source ?? '').trim().slice(0, 60);
  return out;
}

export const hasMeasurements = (m: Measurements | null | undefined) => !!m && m.area_sqft > 0;

/**
 * Values formulas can use. Area-based values are in squares (100 sq ft).
 *   sq        total area in squares          waste    waste as a fraction (0.14)
 *   steep_sq  sq at 10/12+    low_sq  flat–2/12   mid_sq  the rest (sq − steep − low)
 *   pitch_* : squares in each labor band, using the predominant pitch for the "mid" area:
 *   p_low (flat–3/12), p_4_6, p_7_9, p_10_12
 *   eaves rakes ridges hips valleys step wall pipes layers
 */
export function formulaVars(m: Measurements): Record<string, number> {
  const sq = m.area_sqft / 100;
  const low = Math.min(m.low_sq, sq);
  const steep = Math.min(m.steep_sq, Math.max(0, sq - low));
  const mid = Math.max(0, sq - low - steep);
  const p = m.pitch;
  return {
    sq, waste: m.waste_pct / 100, low_sq: low, steep_sq: steep, mid_sq: mid,
    p_low: low + (p > 0 && p <= 3 ? mid : 0),
    p_4_6: p > 3 && p <= 6 ? mid : p === 0 ? mid : 0,
    p_7_9: p > 6 && p <= 9 ? mid : 0,
    p_10_12: steep + (p > 9 ? mid : 0),
    eaves: m.eaves, rakes: m.rakes, ridges: m.ridges, hips: m.hips, valleys: m.valleys,
    step: m.step, wall: m.wall, pipes: m.pipes, layers: m.layers,
  };
}

export const FORMULA_NAMES = Object.keys(formulaVars(EMPTY_MEASUREMENTS));
const FUNCS: Record<string, (...a: number[]) => number> = {
  ceil: Math.ceil, floor: Math.floor, round: Math.round,
  min: (...a) => Math.min(...a), max: (...a) => Math.max(...a),
};

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const v = Number(src.slice(i, j));
      if (!Number.isFinite(v)) throw new Error(`Bad number "${src.slice(i, j)}"`);
      out.push({ t: 'num', v }); i = j; continue;
    }
    if (/[a-z_]/i.test(c)) {
      let j = i;
      while (j < src.length && /[a-z0-9_]/i.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j).toLowerCase() }); i = j; continue;
    }
    if ('+-*/(),'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    throw new Error(`Unexpected "${c}"`);
  }
  return out;
}

/** Evaluate a quantity formula. Throws a readable error for bad formulas. */
export function evalFormula(src: string, vars: Record<string, number>): number {
  const toks = tokenize(String(src ?? ''));
  if (!toks.length) throw new Error('Empty formula');
  if (toks.length > 200) throw new Error('Formula is too long');
  let pos = 0;
  const peek = () => toks[pos];
  const take = (v?: string) => {
    const t = toks[pos];
    if (!t || (v && !(t.t === 'op' && t.v === v))) throw new Error(v ? `Expected "${v}"` : 'Formula ends too soon');
    pos++;
    return t;
  };
  const expr = (): number => {
    let x = term();
    while (peek()?.t === 'op' && (peek()!.v === '+' || peek()!.v === '-')) x = take().v === '+' ? x + term() : x - term();
    return x;
  };
  const term = (): number => {
    let x = unary();
    while (peek()?.t === 'op' && (peek()!.v === '*' || peek()!.v === '/')) {
      const op = take().v;
      const y = unary();
      x = op === '*' ? x * y : y === 0 ? 0 : x / y;
    }
    return x;
  };
  const unary = (): number => {
    if (peek()?.t === 'op' && peek()!.v === '-') { take(); return -unary(); }
    return atom();
  };
  const atom = (): number => {
    const t = take();
    if (t.t === 'num') return t.v;
    if (t.t === 'op' && t.v === '(') { const x = expr(); take(')'); return x; }
    if (t.t === 'id') {
      if (FUNCS[t.v] && peek()?.t === 'op' && peek()!.v === '(') {
        take('(');
        const args = [expr()];
        while (peek()?.t === 'op' && peek()!.v === ',') { take(); args.push(expr()); }
        take(')');
        return FUNCS[t.v](...args);
      }
      if (t.v in vars) return vars[t.v];
      throw new Error(`Unknown name "${t.v}"`);
    }
    throw new Error(`Unexpected "${t.v}"`);
  };
  const out = expr();
  if (pos < toks.length) throw new Error(`Unexpected "${(toks[pos] as { v: unknown }).v}"`);
  if (!Number.isFinite(out)) throw new Error('Formula did not give a number');
  return out;
}

/** Quantity for a line: formula result, never negative, rounded to 2 decimals. Null if no/invalid formula. */
export function quantityFor(formula: string | null | undefined, m: Measurements): number | null {
  if (!formula || !formula.trim()) return null;
  try {
    return Math.max(0, Math.round(evalFormula(formula, formulaVars(m)) * 100) / 100);
  } catch {
    return null;
  }
}

/** Check a formula when it's saved; returns an error message or null. */
export function formulaError(formula: string): string | null {
  if (!formula.trim()) return null;
  try { evalFormula(formula, formulaVars({ ...EMPTY_MEASUREMENTS, area_sqft: 2500, eaves: 150, rakes: 100 })); return null; }
  catch (e) { return (e as Error).message; }
}
