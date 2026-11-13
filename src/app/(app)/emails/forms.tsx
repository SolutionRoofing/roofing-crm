'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import type { FormState } from '@/app/login/actions';
import { SubmitButton } from '@/components/client';
import { LEAD_SOURCES } from '@/lib/options';
import { buildEmail, MERGE_KEYS, type MergeData } from '@/lib/email/compose';
import { countAudience, createCampaign, saveTemplate, sendDueNow } from './actions';

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
  const [audience, setAudience] = useState('all');
  const [count, setCount] = useState<{ key: string; n: number } | null>(null);
  const [, start] = useTransition();
  useEffect(() => {
    let live = true;
    start(async () => { const n = await countAudience(audience); if (live) setCount({ key: audience, n }); });
    return () => { live = false; };
  }, [audience, state.ok]);
  const n = count?.key === audience ? count.n : null;
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
          onChange={e => { setAudience(e.currentTarget.value); const l = e.currentTarget.form?.elements.namedItem('audience_label') as HTMLInputElement | null; if (l) l.value = e.currentTarget.selectedOptions[0].text; }}>
          {AUDIENCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input type="hidden" name="audience_label" defaultValue="Everyone who opted in" />
        <small>
          {n === null ? 'Counting…' : <b className={n ? undefined : 'late'}>{n === 1 ? '1 customer' : `${n} customers`} will get this.</b>}{' '}
          Only customers who agreed to marketing and haven&apos;t unsubscribed.
        </small></div>
      <div className="field"><label htmlFor="cp-date">Send on</label><input id="cp-date" type="date" name="date" defaultValue={today} min={today} required /></div>
      <div style={{ gridColumn: '1 / -1' }}><button className="btn primary" disabled={pending || n === 0}>{pending ? 'Queuing…' : n ? `Queue campaign for ${n}` : 'Queue campaign'}</button></div>
    </form>
  );
}

export type TemplateData = { id: string; name: string; kind: string; subject: string; body: string };

/**
 * Template editor: name, type, subject and message on the left, a live preview of the
 * branded email (filled in with a sample customer) on the right. Fill-in chips insert at the cursor.
 */
export function TemplateEditor({ t, admin, sample, company }: {
  t?: TemplateData; admin: boolean; sample: MergeData; company: { company: string; address: string };
}) {
  const [subject, setSubject] = useState(t?.subject ?? '');
  const [body, setBody] = useState(t?.body ?? '');
  const [kind, setKind] = useState(t?.kind ?? 'followup');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const lastField = useRef<'subject' | 'body'>('body');

  const insert = (key: string) => {
    const token = `{{${key}}}`;
    const el = lastField.current === 'subject' ? subjectRef.current : bodyRef.current;
    if (!el) return;
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
    const next = el.value.slice(0, a) + token + el.value.slice(b);
    if (lastField.current === 'subject') setSubject(next); else setBody(next);
    setTimeout(() => { el.focus(); el.setSelectionRange(a + token.length, a + token.length); }, 0);
  };

  const preview = buildEmail({
    subject, body: body || 'Your message shows here.', kind, data: sample, company,
    unsubscribeUrl: kind === 'marketing' ? '/u/sample' : undefined,
    // A srcdoc frame resolves relative links against this page, so the logo path works as-is.
    logoUrl: '/brand/sr-logo-email.png',
  });

  return (
    <div className="tpl-editor">
      <form action={saveTemplate} className="form-grid tpl-form">
        {t && <input type="hidden" name="id" value={t.id} />}
        <div className="field"><label>Name<input name="name" defaultValue={t?.name} required disabled={!admin} placeholder="e.g. Estimate follow-up 3" /></label></div>
        <div className="field"><label>Type
          <select name="kind" value={kind} onChange={e => setKind(e.target.value)} disabled={!admin}>
            <option value="followup">Follow-up (about their job)</option>
            <option value="marketing">Marketing (opt-in only, adds unsubscribe)</option>
          </select></label></div>
        <div className="field full"><label>Subject
          <input ref={subjectRef} name="subject" value={subject} onChange={e => setSubject(e.target.value)} onFocus={() => { lastField.current = 'subject'; }} required disabled={!admin} /></label></div>
        <div className="field full"><label>Message
          <textarea ref={bodyRef} name="body" rows={10} value={body} onChange={e => setBody(e.target.value)} onFocus={() => { lastField.current = 'body'; }} required disabled={!admin} /></label></div>
        {admin && (
          <div className="full tpl-keys">
            <span className="muted">Insert:</span>
            {MERGE_KEYS.map(k => <button type="button" key={k} className="merge-key" onClick={() => insert(k)}>{k.replace(/_/g, ' ')}</button>)}
          </div>
        )}
        {admin && <div className="full"><SubmitButton pendingText="Saving…">{t ? 'Save template' : 'Add template'}</SubmitButton></div>}
      </form>
      <div className="tpl-preview">
        <div className="tpl-preview-head">
          <span className="tile-label">Preview · sample customer</span>
          <b>{preview.subject || 'No subject yet'}</b>
        </div>
        <iframe title="Email preview" srcDoc={preview.html} sandbox="allow-same-origin" />
      </div>
    </div>
  );
}
