'use client';

import { useActionState } from 'react';
import type { FormState } from '@/app/login/actions';
import { importPriceList, saveCompany, saveMyProfile } from './actions';

function Status({ state }: { state: FormState }) {
  if (state.error) return <p className="form-error" role="alert" style={{ gridColumn: '1 / -1' }}>{state.error}</p>;
  if (state.ok) return <p className="form-ok" role="status" style={{ gridColumn: '1 / -1' }}>{state.ok}</p>;
  return null;
}

export function ProfileForm({ fullName, phone, email }: { fullName: string; phone: string; email: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveMyProfile, {});
  return (
    <form action={action} className="form-grid">
      <Status state={state} />
      <div className="field"><label htmlFor="me-name">Your name</label><input id="me-name" name="full_name" defaultValue={fullName} required /></div>
      <div className="field"><label htmlFor="me-phone">Your phone</label><input id="me-phone" name="phone" type="tel" defaultValue={phone} /></div>
      <div className="field" style={{ gridColumn: '1 / -1' }}><label>Sign-in email</label><p className="muted">{email}</p></div>
      <div><button className="btn primary" disabled={pending}>{pending ? 'Saving…' : 'Save'}</button></div>
    </form>
  );
}

type Company = { company: string; phone: string; email: string; address: string; license: string; tax_rate: number; material_tax_rate: number; review_url: string; terms: string };

export function CompanyForm({ s }: { s: Company }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveCompany, {});
  return (
    <form action={action} className="form-grid">
      <Status state={state} />
      <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="co-name">Company name</label><input id="co-name" name="company" defaultValue={s.company} required /></div>
      <div className="field"><label htmlFor="co-phone">Phone</label><input id="co-phone" name="phone" type="tel" defaultValue={s.phone} /></div>
      <div className="field"><label htmlFor="co-email">Email</label><input id="co-email" name="email" type="email" defaultValue={s.email} /></div>
      <div className="field" style={{ gridColumn: '1 / -1' }}>
        <label htmlFor="co-address">Mailing address</label><input id="co-address" name="address" defaultValue={s.address} />
        <small>Required by law (CAN-SPAM) at the bottom of marketing emails.</small>
      </div>
      <div className="field"><label htmlFor="co-license">License #</label><input id="co-license" name="license" defaultValue={s.license} /></div>
      <div className="field">
        <label htmlFor="co-mattax">Tax you pay on materials %</label><input id="co-mattax" name="material_tax_rate" inputMode="decimal" defaultValue={s.material_tax_rate || ''} />
        <small>Counted as part of material cost on estimates, so margin is right. Not shown to customers.</small>
      </div>
      <div className="field">
        <label htmlFor="co-tax">Sales tax added to customer estimates %</label><input id="co-tax" name="tax_rate" inputMode="decimal" defaultValue={s.tax_rate || ''} />
        <small>Leave at 0 if customers don&apos;t pay sales tax on your estimates.</small>
      </div>
      <div className="field" style={{ gridColumn: '1 / -1' }}>
        <label htmlFor="co-review">Review link</label><input id="co-review" name="review_url" type="url" defaultValue={s.review_url} placeholder="https://g.page/r/…" />
        <small>Used in the review-request email.</small>
      </div>
      <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="co-terms">Estimate terms</label><textarea id="co-terms" name="terms" rows={3} defaultValue={s.terms} /></div>
      <div><button className="btn primary" disabled={pending}>{pending ? 'Saving…' : 'Save company details'}</button></div>
    </form>
  );
}

/** Price list CSV import (JobNimbus export, ABC price sheet, or any spreadsheet saved as CSV). */
export function PriceImportForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(importPriceList, {});
  return (
    <form action={action} className="price-import">
      <Status state={state} />
      <p className="muted">
        Columns it understands: <b>Name</b> (required), Description, UOM, Material cost, Labor cost, Price (or Material price +
        Labor price), Markup, Category or Type, and Active/Visible. Items are matched by name, so importing again updates prices.
      </p>
      <div className="inline-form">
        <input type="file" name="file" accept=".csv,text/csv" aria-label="Price list CSV file" required />
        <label className="inline-check"><input type="checkbox" name="replace" /> Replace my whole price list with this file</label>
        <button className="btn small primary" disabled={pending}>{pending ? 'Importing…' : 'Import'}</button>
      </div>
    </form>
  );
}
