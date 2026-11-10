'use client';

import { useActionState, useState } from 'react';
import type { FormState } from '@/app/login/actions';
import { JOB_TYPES, LEAD_SOURCES, ROOF_TYPES } from '@/lib/options';
import { createLead } from '../actions';

type Option = { id: string; label: string };

export function LeadForm({ contacts, reps, defaultContact, defaultRep }: {
  contacts: Option[]; reps: Option[]; defaultContact: string; defaultRep: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(createLead, {});
  const [contactId, setContactId] = useState(defaultContact);

  return (
    <form action={action}>
      {state.error && <p className="form-error" role="alert" style={{ marginBottom: 12 }}>{state.error}</p>}
      <section className="panel">
        <div className="panel-head"><h2>Customer</h2></div>
        <div className="form-grid">
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="contact_id">Existing customer</label>
            <select id="contact_id" name="contact_id" value={contactId} onChange={e => setContactId(e.target.value)}>
              <option value="">New customer</option>
              {contacts.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          {!contactId && (
            <>
              <div className="field"><label htmlFor="first">First name</label><input id="first" name="first" autoComplete="off" /></div>
              <div className="field"><label htmlFor="last">Last name</label><input id="last" name="last" autoComplete="off" /></div>
              <div className="field"><label htmlFor="phone">Phone</label><input id="phone" name="phone" type="tel" /></div>
              <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" /></div>
              <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="address">Street address</label><input id="address" name="address" /></div>
              <div className="field"><label htmlFor="city">City</label><input id="city" name="city" /></div>
              <div className="form-grid" style={{ gap: 8 }}>
                <div className="field"><label htmlFor="st">State</label><input id="st" name="st" maxLength={2} /></div>
                <div className="field"><label htmlFor="zip">ZIP</label><input id="zip" name="zip" inputMode="numeric" maxLength={10} /></div>
              </div>
              <div className="field">
                <label htmlFor="source">Lead source</label>
                <select id="source" name="source" defaultValue="Door knocking">{LEAD_SOURCES.map(s => <option key={s}>{s}</option>)}</select>
              </div>
              <div className="field check-field">
                <label><input type="checkbox" name="marketing" /> OK to send marketing emails</label>
                <small>Only tick this if the customer agreed.</small>
              </div>
              <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="notes">Notes</label><textarea id="notes" name="notes" rows={2} /></div>
            </>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Job</h2></div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="type">Type</label>
            <select id="type" name="type" defaultValue="Retail">{JOB_TYPES.map(t => <option key={t}>{t}</option>)}</select>
          </div>
          <div className="field">
            <label htmlFor="rep_id">Sales rep</label>
            <select id="rep_id" name="rep_id" defaultValue={defaultRep}>
              <option value="">Unassigned</option>
              {reps.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="name">Job name</label>
            <input id="name" name="name" placeholder="Leave blank for e.g. “Thompson Re-roof”" />
          </div>
          <div className="field">
            <label htmlFor="roof_type">Roof type</label>
            <select id="roof_type" name="roof_type" defaultValue="Asphalt shingle">{ROOF_TYPES.map(t => <option key={t}>{t}</option>)}</select>
          </div>
          <div className="form-grid" style={{ gap: 8 }}>
            <div className="field"><label htmlFor="squares">Squares</label><input id="squares" name="squares" inputMode="decimal" /></div>
            <div className="field"><label htmlFor="pitch">Pitch</label><input id="pitch" name="pitch" placeholder="6/12" /></div>
          </div>
        </div>
      </section>
      <button className="btn primary" disabled={pending}>{pending ? 'Saving…' : 'Create lead'}</button>
    </form>
  );
}
