import { SubmitButton } from '@/components/client';
import { saveMeasurements } from '@/app/(app)/jobs/actions';
import { GafImport } from '@/components/gaf-import';
import { cleanMeasurements, hasMeasurements, MEASURE_FIELDS } from '@/lib/measure';

const SOURCES = ['GAF QuickMeasure', 'HOVER', 'Roofr', 'EagleView', 'Measured by hand', 'Other'];

/** Job page: the numbers from the measurement report. They size estimates with one click. */
export function MeasurementsPanel({ jobId, raw, address }: { jobId: string; raw: unknown; address?: string }) {
  const m = cleanMeasurements(raw);
  const has = hasMeasurements(m);
  const sq = m.area_sqft / 100;
  return (
    <section className="panel" id="measurements">
      <div className="panel-head">
        <h2>Measurements</h2>
        {has && (
          <span className="muted">
            {sq.toFixed(1)} sq{m.waste_pct ? ` · ${(sq * (1 + m.waste_pct / 100)).toFixed(1)} sq with ${m.waste_pct}% waste` : ''}{m.source ? ` · ${m.source}` : ''}
          </span>
        )}
      </div>
      <GafImport formId={`measure-${jobId}`} jobAddress={address} />
      <details open={!has}>
        <summary className="link-btn">{has ? 'Edit measurements' : 'Or type in the numbers from the measurement report'}</summary>
        <form action={saveMeasurements} className="measure-form" id={`measure-${jobId}`}>
          <input type="hidden" name="id" value={jobId} />
          <div className="field">
            <label htmlFor="m-source">Report</label>
            <select id="m-source" name="source" defaultValue={m.source}>
              <option value="">Choose…</option>
              {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {MEASURE_FIELDS.map(f => (
            <div className="field" key={f.key}>
              <label htmlFor={`m-${f.key}`}>{f.label}{f.unit ? ` (${f.unit})` : ''}</label>
              <input id={`m-${f.key}`} name={f.key} inputMode="decimal" defaultValue={m[f.key] ? String(m[f.key]) : f.key === 'layers' ? '1' : ''} />
              {f.hint && <small>{f.hint}</small>}
            </div>
          ))}
          <div className="measure-actions"><SubmitButton>Save measurements</SubmitButton></div>
        </form>
      </details>
      {has && <p className="muted" style={{ marginTop: 8 }}>In an estimate, choose <b>Fill quantities from measurements</b> to size every line that has a formula.</p>}
    </section>
  );
}
