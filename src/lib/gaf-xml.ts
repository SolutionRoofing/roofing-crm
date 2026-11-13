// Reads a GAF QuickMeasure "Report XML" export into job measurements.
//
// The file is roof geometry, not a summary: each ROOF has FACES (POLYGON pitch + size in sq ft),
// LINES (type + two point ids) and POINTS (x,y,z in feet). Totals are summed here:
//   area = face sizes, line lengths = distance between their points, grouped by line type.
// Lines shared by two faces appear once, so nothing is double-counted.
// Not in the file: suggested waste, pipe jacks, layers — the rep fills those in.
// No imports and no DOM, so it runs in the browser and in Node tests.

export type GafResult = {
  address: string;
  area_sqft: number;
  pitch: number;          // predominant pitch (most area)
  low_sq: number;         // flat to 2/12, squares
  steep_sq: number;       // 10/12 and steeper, squares
  eaves: number; rakes: number; ridges: number; hips: number; valleys: number;
  step: number; wall: number; chimney: number;
  chimneys: number;       // how many chimneys (each closed loop of CHIMNEY lines)
  faces: number;
  ignored: string[];      // line types we don't use, e.g. PARAPET
};

const LINE_FIELD: Record<string, keyof GafResult> = {
  EAVE: 'eaves', RAKE: 'rakes', RIDGE: 'ridges', HIP: 'hips', VALLEY: 'valleys',
  STEPFLASH: 'step', FLASHING: 'wall', CHIMNEY: 'chimney',
};

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}
const tags = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map(m => attrs(m[0]));
const r1 = (n: number) => Math.round(n * 10) / 10;

export function parseGafXml(xml: string): GafResult {
  if (!/<DATA_EXPORT\b/.test(xml) || !/<ROOF\b/.test(xml)) {
    throw new Error("This doesn't look like a GAF QuickMeasure XML report (no roof data found).");
  }
  const loc = tags(xml, 'LOCATION')[0] ?? {};
  const address = [loc.address, loc.city, [loc.state, loc.postal].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const out: GafResult = {
    address, area_sqft: 0, pitch: 0, low_sq: 0, steep_sq: 0, eaves: 0, rakes: 0, ridges: 0, hips: 0, valleys: 0,
    step: 0, wall: 0, chimney: 0, chimneys: 0, faces: 0, ignored: [],
  };
  const byPitch = new Map<number, number>();
  const ignored = new Set<string>();

  // Point and line ids repeat between structures (house, garage), so work one ROOF at a time.
  for (const [, roof] of xml.matchAll(/<ROOF\b[^>]*>([\s\S]*?)<\/ROOF>/g)) {
    const pts = new Map<string, number[]>();
    for (const p of tags(roof, 'POINT')) pts.set(p.id, (p.data ?? '').split(',').map(Number));
    const lines = new Map<string, { type: string; len: number }>();
    for (const l of tags(roof, 'LINE')) {
      const [a, b] = (l.path ?? '').split(',').map(id => pts.get(id));
      const len = a && b && a.length === 3 && b.length === 3 ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : 0;
      const type = (l.type ?? '').toUpperCase();
      lines.set(l.id, { type, len: Number.isFinite(len) ? len : 0 });
      const field = LINE_FIELD[type];
      if (field) (out[field] as number) += Number.isFinite(len) ? len : 0;
      else if (type) ignored.add(type);
    }
    for (const poly of tags(roof, 'POLYGON')) {
      const edges = (poly.path ?? '').split(',').map(id => lines.get(id)).filter(Boolean);
      // A face bounded only by chimney lines is the chimney top, not roof.
      if (edges.length && edges.every(e => e!.type === 'CHIMNEY')) { out.chimneys += 1; continue; }
      const size = Number(poly.size) || 0;
      const pitch = Math.round(Number(poly.pitch) || 0);
      out.area_sqft += size;
      out.faces += 1;
      byPitch.set(pitch, (byPitch.get(pitch) ?? 0) + size);
      if (pitch <= 2) out.low_sq += size / 100;
      else if (pitch >= 10) out.steep_sq += size / 100;
    }
  }
  if (!out.area_sqft) throw new Error('The report has no roof area in it.');
  // No chimney top drawn but chimney lines present: count about one chimney per 4 sides.
  if (!out.chimneys && out.chimney > 0) out.chimneys = Math.max(1, Math.round(tags(xml, 'LINE').filter(l => (l.type ?? '').toUpperCase() === 'CHIMNEY').length / 4));
  out.pitch = [...byPitch.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  for (const k of ['eaves', 'rakes', 'ridges', 'hips', 'valleys', 'step', 'wall', 'chimney'] as const) out[k] = r1(out[k]);
  out.area_sqft = Math.round(out.area_sqft);
  out.low_sq = Math.round(out.low_sq * 100) / 100;
  out.steep_sq = Math.round(out.steep_sq * 100) / 100;
  out.ignored = [...ignored];
  return out;
}
