'use client';

import { useActionState, useState } from 'react';
import { sendPasswordReset, signIn, type FormState } from './actions';

export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const [mode, setMode] = useState<'signin' | 'reset'>('signin');
  const [state, signInAction, signingIn] = useActionState<FormState, FormData>(signIn, {});
  const [resetState, resetAction, resetting] = useActionState<FormState, FormData>(sendPasswordReset, {});

  if (mode === 'reset') {
    return (
      <>
        <form action={resetAction}>
          <p className="muted">We&apos;ll email you a link to choose a new password.</p>
          {resetState.error && <p className="form-error" role="alert">{resetState.error}</p>}
          {resetState.ok && <p className="form-ok" role="status">{resetState.ok}</p>}
          <div className="field">
            <label htmlFor="reset-email">Email</label>
            <input id="reset-email" name="email" type="email" autoComplete="email" required />
          </div>
          <button className="btn primary" disabled={resetting}>{resetting ? 'Sending…' : 'Send reset link'}</button>
        </form>
        <p className="auth-links"><button type="button" className="plain link-btn" onClick={() => setMode('signin')}>Back to sign in</button></p>
      </>
    );
  }

  return (
    <>
      <form action={signInAction}>
        {notice && <p className="form-error" role="alert">{notice}</p>}
        {state.error && <p className="form-error" role="alert">{state.error}</p>}
        <input type="hidden" name="next" value={next} />
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <button className="btn primary" disabled={signingIn}>{signingIn ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="auth-links"><button type="button" className="plain link-btn" onClick={() => setMode('reset')}>Forgot your password?</button></p>
    </>
  );
}
