import { LEAD_SOURCES } from '@/lib/options';

type Contact = {
  first?: string; last?: string; phone?: string; email?: string; address?: string; city?: string; st?: string; zip?: string;
  source?: string; tags?: string; notes?: string; marketing?: boolean; unsubscribed_at?: string | null;
};

/** Customer form fields, shared by "Add customer" and the customer page. */
export function ContactFields({ c = {} }: { c?: Contact }) {
  return (
    <>
      <div className="field"><label htmlFor="ct-first">First name</label><input id="ct-first" name="first" defaultValue={c.first} /></div>
      <div className="field"><label htmlFor="ct-last">Last name</label><input id="ct-last" name="last" defaultValue={c.last} /></div>
      <div className="field"><label htmlFor="ct-phone">Phone</label><input id="ct-phone" name="phone" type="tel" defaultValue={c.phone} /></div>
      <div className="field"><label htmlFor="ct-email">Email</label><input id="ct-email" name="email" type="email" defaultValue={c.email} /></div>
      <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="ct-address">Street address</label><input id="ct-address" name="address" defaultValue={c.address} /></div>
      <div className="field"><label htmlFor="ct-city">City</label><input id="ct-city" name="city" defaultValue={c.city} /></div>
      <div className="form-grid" style={{ gap: 8 }}>
        <div className="field"><label htmlFor="ct-st">State</label><input id="ct-st" name="st" maxLength={2} defaultValue={c.st} /></div>
        <div className="field"><label htmlFor="ct-zip">ZIP</label><input id="ct-zip" name="zip" inputMode="numeric" maxLength={10} defaultValue={c.zip} /></div>
      </div>
      <div className="field"><label htmlFor="ct-source">Lead source</label>
        <select id="ct-source" name="source" defaultValue={c.source || 'Other'}>{LEAD_SOURCES.map(s => <option key={s}>{s}</option>)}</select></div>
      <div className="field"><label htmlFor="ct-tags">Tags</label><input id="ct-tags" name="tags" defaultValue={c.tags} placeholder="e.g. vip, landlord" /></div>
      <div className="field check-field" style={{ gridColumn: '1 / -1' }}>
        <label><input type="checkbox" name="marketing" defaultChecked={c.marketing} /> OK to send marketing emails</label>
        <small>{c.unsubscribed_at ? `Unsubscribed ${new Date(c.unsubscribed_at).toLocaleDateString('en-US')}. Only re-tick this if they asked to be added back.` : 'Only tick this if the customer agreed.'}</small>
      </div>
      <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="ct-notes">Notes</label><textarea id="ct-notes" name="notes" rows={3} defaultValue={c.notes} /></div>
    </>
  );
}
