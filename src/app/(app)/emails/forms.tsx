'use client';

import { useActionState } from 'react';
import type { FormState } from '@/app/login/actions';
import { LEAD_SOURCES } from '@/lib/options';
import { createCampaign, sendDueNow } from './actions';

export function SendDueNow() {
  const [state, action, pending] = useActionState<FormState, FormData>(sendDueNow, {});
  return (
    <form action={action} className="inline-form">
      <button className="btn small" disabled={pending}>{pending ? 'Sending…' : 'Send due emails now'}</button>
      {state.error && <span className="form-error">{state.error}</span>}
      {state.ok && <span className="form-ok">{state.ok}</span>}
    </form>
  );
}

const AUDIENCES: [string, string][] = [
  ['all', 'Everyone who opted in'],
  ['past', 'Past customers (completed jobs)'],
  ['open', 'Customers with an open job'],
  ['lost', 'Lost leads'],
  ...LEAD_SOURCES.map(s => [`source:${s}`, `Lead source: ${s}`] as [string, string]),
];

export function CampaignForm({ templates, today }: { templates: { id: string; name: string }[]; today: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createCampaign, {});
  return (
    <form action={action} className="form-grid" key={state.ok ?? 'campaign'}>
      {state.error && <p className="form-error" role="alert" style={{ gridColumn: '1 / -1' }}>{state.error}</p>}
      {state.ok && <p className="form-ok" role="status" style={{ gridColumn: '1 / -1' }}>{state.ok}</p>}
      <div className="field"><label htmlFor="cp-name">Campaign name</label><input id="cp-name" name="name" required placeholder="e.g. Spring storm check" /></div>
      <div className="field"><label htmlFor="cp-template">Template</label>
        <select id="cp-template" name="template_id" required defaultValue="">
          <option value="" disabled>{templates.length ? 'Pick a marketing template' : 'Add a marketing template first'}</option>
          {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select></div>
      <div className="field"><label htmlFor="cp-aud">Send to</label>
        <select id="cp-aud" name="audience" defaultValue="all"
          onChange={e => { const l = e.currentTarget.form?.elements.namedItem('audience_label') as HTMLInputElement | null; if (l) l.value = e.currentTarget.selectedOptions[0].text; }}>
          {AUDIENCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input type="hidden" name="audience_label" defaultValue="Everyone who opted in" />
        <small>Only customers who agreed to marketing and haven&apos;t unsubscribed.</small></div>
      <div className="field"><label htmlFor="cp-date">Send on</label><input id="cp-date" type="date" name="date" defaultValue={today} min={today} required /></div>
      <div style={{ gridColumn: '1 / -1' }}><button className="btn primary" disabled={pending}>{pending ? 'Queuing…' : 'Queue campaign'}</button></div>
    </form>
  );
}
