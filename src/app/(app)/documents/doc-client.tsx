'use client';

import { useActionState, useState } from 'react';
import type { FormState } from '@/app/login/actions';
import { PAYMENT_METHODS } from '@/lib/documents';
import { emailDocument, recordPayment } from './actions';

export function EmailDocButton({ documentId, to }: { documentId: string; to: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(emailDocument, {});
  return (
    <form action={action} className="email-doc">
      <input type="hidden" name="id" value={documentId} />
      <button className="btn small primary" disabled={pending}>{pending ? 'Sending…' : `Send by email to ${to}`}</button>
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      {state.ok && <p className="form-ok" role="status">{state.ok}</p>}
    </form>
  );
}

export function PrintButton() {
  return <button type="button" className="btn" onClick={() => window.print()}>Print / Save as PDF</button>;
}

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-link">
      <input readOnly value={url} aria-label="Customer link" onFocus={e => e.currentTarget.select()} />
      <button type="button" className="btn small" onClick={async () => {
        try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* select-and-copy still works */ }
      }}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

export function PaymentForm({ documentId, balance, today }: { documentId: string; balance: number; today: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(recordPayment, {});
  return (
    <form action={action} className="form-grid" key={state.ok ? `ok-${balance}` : 'form'}>
      <input type="hidden" name="document_id" value={documentId} />
      {state.error && <p className="form-error" role="alert" style={{ gridColumn: '1 / -1' }}>{state.error}</p>}
      {state.ok && <p className="form-ok" role="status" style={{ gridColumn: '1 / -1' }}>{state.ok}</p>}
      <div className="field"><label htmlFor="pay-amount">Amount</label><input id="pay-amount" name="amount" inputMode="decimal" defaultValue={balance > 0 ? balance.toFixed(2) : ''} required /></div>
      <div className="field"><label htmlFor="pay-date">Date</label><input id="pay-date" type="date" name="date" defaultValue={today} /></div>
      <div className="field"><label htmlFor="pay-method">Method</label>
        <select id="pay-method" name="method" defaultValue="Check">{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select></div>
      <div className="field"><label htmlFor="pay-note">Note</label><input id="pay-note" name="note" placeholder="Check #, reference…" /></div>
      <div style={{ gridColumn: '1 / -1' }}><button className="btn primary" disabled={pending}>{pending ? 'Saving…' : 'Record payment'}</button></div>
    </form>
  );
}
