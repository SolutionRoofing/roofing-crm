'use client';

import { useActionState, useState } from 'react';
import { sharePhotos, type ShareState } from '@/app/(app)/photos/actions';

type Thumb = { id: string; thumbUrl: string; caption: string };

/** Staff: pick photos and send the customer a link (by email, or copy it into a text). */
export function PhotoShare({ jobId, photos, customerEmail, emailReady }: {
  jobId: string; photos: Thumb[]; customerEmail: string; emailReady: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(photos.map(p => p.id)));
  const [copied, setCopied] = useState(false);
  const [state, action, pending] = useActionState<ShareState, FormData>(sharePhotos, {});

  if (!photos.length) return null;
  if (!open) {
    return <button type="button" className="btn small" onClick={() => setOpen(true)}>Share with customer</button>;
  }

  const toggle = (id: string) => setPicked(s => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const all = picked.size === photos.length;
  const canEmail = emailReady && !!customerEmail;
  const copy = async (link: string) => {
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); }
  };

  return (
    <form action={action} className="share-box" onSubmit={() => setCopied(false)}>
      <input type="hidden" name="job_id" value={jobId} />
      <div className="panel-head">
        <h3>Share photos with the customer</h3>
        <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">×</button>
      </div>
      <p className="muted">
        {picked.size} of {photos.length} picked ·{' '}
        <button type="button" className="link-btn" onClick={() => setPicked(all ? new Set() : new Set(photos.map(p => p.id)))}>
          {all ? 'Untick all' : 'Tick all'}
        </button>
      </p>
      <div className="photo-grid share-grid">
        {photos.map(p => (
          <label key={p.id} className={`photo-tile share-pick${picked.has(p.id) ? ' on' : ''}`}>
            <input type="checkbox" name="photo" value={p.id} checked={picked.has(p.id)} onChange={() => toggle(p.id)}
              aria-label={p.caption ? `Include photo: ${p.caption}` : 'Include photo'} />
            {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
            <img src={p.thumbUrl} alt="" loading="lazy" />
          </label>
        ))}
      </div>
      <div className="field" style={{ marginTop: 10 }}>
        <label htmlFor="share-msg">Message (optional)</label>
        <textarea id="share-msg" name="message" rows={2} placeholder="e.g. Here's the hail damage we found on the north slope." />
      </div>
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      {state.ok && <p className="form-ok" role="status">{state.ok}</p>}
      {state.link && (
        <div className="inline-form" style={{ marginBottom: 8 }}>
          <input readOnly value={state.link} aria-label="Customer link" className="grow-input" onFocus={e => e.target.select()} />
          <button type="button" className="btn small" onClick={() => copy(state.link!)}>{copied ? 'Copied' : 'Copy'}</button>
          <a className="btn small" href={state.link} target="_blank" rel="noreferrer">Preview</a>
        </div>
      )}
      <div className="inline-form">
        <button className="btn small primary" name="send" value="email" disabled={pending || !picked.size || !canEmail}>
          {pending ? 'Working…' : 'Email to customer'}
        </button>
        <button className="btn small" name="send" value="link" disabled={pending || !picked.size}>Make a link to copy</button>
      </div>
      <small className="muted">
        {!emailReady ? 'Email sending is not connected, so copy the link into a text or your own email.'
          : customerEmail ? `Emails go to ${customerEmail} from the CRM.` : 'The customer has no email address. Make a link and text it instead.'}
      </small>
    </form>
  );
}
