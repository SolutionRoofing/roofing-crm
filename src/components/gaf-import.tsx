'use client';

import { useRef, useState } from 'react';
import { parseGafXml } from '@/lib/gaf-xml';

/**
 * "Upload GAF XML" for the Measurements form: reads the file in the browser, fills the
 * boxes and leaves saving to the rep, so the numbers can be checked first.
 */
export function GafImport({ formId, jobAddress }: { formId: string; jobAddress?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; warn?: string } | null>(null);

  const load = async (file: File) => {
    try {
      if (file.size > 5_000_000) throw new Error('That file is too big to be a measurement report.');
      const r = parseGafXml(await file.text());
      const form = document.getElementById(formId) as HTMLFormElement | null;
      if (!form) return;
      form.closest('details')?.setAttribute('open', '');
      const set = (name: string, v: number | string) => {
        const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
        if (el) el.value = typeof v === 'number' ? (v ? String(v) : '') : v;
      };
      set('source', 'GAF QuickMeasure');
      for (const k of ['area_sqft', 'pitch', 'low_sq', 'steep_sq', 'eaves', 'rakes', 'ridges', 'hips', 'valleys', 'step', 'wall', 'chimney', 'chimneys'] as const) set(k, r[k]);
      // Street number check: catches uploading the wrong job's report.
      const num = (s?: string) => s?.trim().match(/^\d+/)?.[0];
      const warn = jobAddress && num(r.address) && num(jobAddress) && num(r.address) !== num(jobAddress)
        ? `This report is for ${r.address}, but the job is at ${jobAddress}. Check it's the right file.` : undefined;
      setMsg({
        ok: true,
        warn,
        text: `Filled from ${r.address || 'the report'}: ${(r.area_sqft / 100).toFixed(1)} sq at ${r.pitch}/12 across ${r.faces} faces. `
          + `Now type the suggested waste from the PDF, pipe jacks and layers, then save.`
          + (r.ignored.length ? ` (Not used: ${r.ignored.join(', ').toLowerCase()} lines.)` : ''),
      });
      (form.elements.namedItem('waste_pct') as HTMLInputElement | null)?.focus();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message || 'Could not read that file.' });
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="gaf-import">
      <input ref={input} type="file" accept=".xml,text/xml,application/xml" hidden onChange={e => { const f = e.target.files?.[0]; if (f) load(f); }} />
      <button type="button" className="btn small cta" onClick={() => input.current?.click()}>Upload GAF XML</button>
      {msg && <p className={msg.ok ? 'form-ok' : 'form-error'} role="status">{msg.text}</p>}
      {msg?.warn && <p className="form-error" role="alert">{msg.warn}</p>}
    </div>
  );
}
