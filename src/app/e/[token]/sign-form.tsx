'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import type { FormState } from '@/app/login/actions';
import { signShared } from '@/app/(app)/documents/actions';

/** Typed name + drawn signature + "I accept" box. Works with a finger on phones. */
export function SignForm({ token, defaultName, total }: { token: string; defaultName: string; total: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(signShared, {});
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [signature, setSignature] = useState('');
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1d2730';
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = e.currentTarget.getContext('2d')!;
    const [x, y] = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext('2d')!;
    const [x, y] = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const end = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    setSignature(e.currentTarget.toDataURL('image/png'));
  };
  const clear = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setSignature('');
  };

  if (state.ok === 'signed') {
    return (
      <div className="panel sign-panel" role="status">
        <h2>Thank you.</h2>
        <p style={{ marginTop: 6 }}>Your signed estimate has been sent to us. We&apos;ll be in touch shortly to schedule your project.</p>
      </div>
    );
  }

  return (
    <form action={action} className="panel sign-panel">
      <h2>Accept this estimate</h2>
      <p className="muted" style={{ margin: '4px 0 12px' }}>Total {total}. Sign below to approve the work and the terms above.</p>
      {state.error && <p className="form-error" role="alert" style={{ marginBottom: 10 }}>{state.error}</p>}
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="signature" value={signature} />
      <div className="field">
        <label htmlFor="sign-name">Your full name</label>
        <input id="sign-name" name="name" defaultValue={defaultName} autoComplete="name" required />
      </div>
      <div className="field" style={{ marginTop: 10 }}>
        <label htmlFor="sign-pad">Signature</label>
        <canvas id="sign-pad" ref={canvasRef} className="sign-pad" aria-label="Signature pad: draw your signature"
          onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
        <button type="button" className="plain link-btn" onClick={clear} style={{ marginTop: 4 }}>Clear signature</button>
      </div>
      <div className="field check-field" style={{ marginTop: 10 }}>
        <label><input type="checkbox" name="agree" /> I accept this estimate and agree to sign electronically.</label>
      </div>
      <button className="btn primary sign-btn" disabled={pending}>{pending ? 'Sending…' : 'Sign and accept'}</button>
    </form>
  );
}
