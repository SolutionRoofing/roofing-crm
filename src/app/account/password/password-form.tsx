'use client';

import { useActionState } from 'react';
import type { FormState } from '@/app/login/actions';
import { setPassword } from './actions';

export function PasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(setPassword, {});
  return (
    <form action={action}>
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      <div className="field">
        <label htmlFor="password">New password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        <small>At least 10 characters.</small>
      </div>
      <div className="field">
        <label htmlFor="confirm">Type it again</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
      </div>
      <button className="btn primary" disabled={pending}>{pending ? 'Saving…' : 'Save password'}</button>
    </form>
  );
}
