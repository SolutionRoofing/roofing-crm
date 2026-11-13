'use client';

import { useEffect, useRef, useState } from 'react';
import { ConfirmButton } from '@/components/client';
import { resetCalendarLink } from './actions';

/** "Google Calendar" button: private subscribe links for my appointments or everyone's, with steps. */
export function CalendarLinks({ mine, everyone }: { mine: string; everyone: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState('');
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(''), 2000); return () => clearTimeout(t); }, [copied]);
  const copy = async (url: string, which: string) => {
    try { await navigator.clipboard.writeText(url); setCopied(which); } catch { window.prompt('Copy this link:', url); }
  };
  const row = (label: string, url: string, which: string) => (
    <div className="field">
      <label>{label}</label>
      <div className="copy-row">
        <input readOnly value={url} onFocus={e => e.currentTarget.select()} aria-label={label} />
        <button type="button" className="btn small" onClick={() => copy(url, which)}>{copied === which ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  );
  return (
    <>
      <button type="button" className="btn" onClick={() => ref.current?.showModal()}>Google Calendar</button>
      <dialog ref={ref} className="modal" aria-label="Show in Google Calendar" onClick={e => { if (e.target === e.currentTarget) ref.current?.close(); }}>
        <div className="modal-body">
          <div className="panel-head"><h2>Show this calendar in Google Calendar</h2><button type="button" className="icon-btn" aria-label="Close" onClick={() => ref.current?.close()}>×</button></div>
          {row('My appointments', mine, 'mine')}
          {row("Everyone's appointments and installs", everyone, 'all')}
          <ol className="steps">
            <li>Copy a link.</li>
            <li>On a computer, open Google Calendar. Next to <b>Other calendars</b>, click <b>+</b>, then <b>From URL</b>.</li>
            <li>Paste the link and click <b>Add calendar</b>. It shows up on your phone too.</li>
          </ol>
          <p className="muted">
            This is one-way: new appointments are added here and show up in Google. Google checks for changes every few hours, so a new
            appointment can take a while to appear there. Works with Apple Calendar and Outlook too.
          </p>
          <p className="muted">Keep these links private — anyone with one can see the appointments.</p>
          <form action={resetCalendarLink} style={{ marginTop: 10 }}>
            <ConfirmButton message="Make new links? The old ones stop working and you'll need to add the calendar to Google again.">Reset my links</ConfirmButton>
          </form>
        </div>
      </dialog>
    </>
  );
}
