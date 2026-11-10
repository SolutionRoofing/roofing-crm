'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/browser';
import { safeNext } from '@/lib/safe-next';

// Supabase's standard invite emails send people here with the session in the URL
// fragment (#access_token=...), which only the browser can read. Store it as a
// cookie session, then continue to "Choose a password".
export function AcceptInvite() {
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function accept() {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const next = safeNext(new URLSearchParams(window.location.search).get('next')) ?? '/account/password';
      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');
      const { error: e } = accessToken && refreshToken
        ? await createClient().auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        : { error: new Error(hash.get('error_description')?.replace(/\+/g, ' ') || 'This link is missing its sign-in details.') };
      if (cancelled) return;
      if (e) setError(e.message);
      else window.location.replace(next);
    }
    accept();
    return () => { cancelled = true; };
  }, []);

  if (!error) return <p className="muted">Signing you in…</p>;
  return (
    <>
      <p className="form-error" role="alert">{error}</p>
      <p className="muted" style={{ marginTop: 10 }}>
        Invite links expire after a day and work once. Ask the office to send a new one, or <a href="/login">reset your password</a>.
      </p>
    </>
  );
}
