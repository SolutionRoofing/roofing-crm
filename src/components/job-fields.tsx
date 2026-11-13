import { SERVICES } from '@/lib/options';

/** Service tick-boxes plus the insurance switch, shared by "Add lead" and the job page. */
export function ServiceFields({ selected = [], insurance = false }: { selected?: string[]; insurance?: boolean }) {
  return (
    <>
      <fieldset className="field service-field" style={{ gridColumn: '1 / -1' }}>
        <legend>Services</legend>
        <div className="service-checks">
          {SERVICES.map(s => (
            <label key={s} className="service-check">
              <input type="checkbox" name="services" value={s} defaultChecked={selected.includes(s)} /> {s}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field check-field stack" style={{ gridColumn: '1 / -1' }}>
        <label><input type="checkbox" name="insurance" defaultChecked={insurance} /> Insurance claim</label>
        <small>Adds a Claim section to the job for the carrier, adjuster and claim money.</small>
      </div>
    </>
  );
}
