import { Suspense } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/logo';
import { getCurrentUser } from '@/lib/auth';
import { PasswordForm } from './password-form';

export const metadata: Metadata = { title: 'Choose a password' };

export default function PasswordPage() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo"><Logo height={120} /></div>
        <h1>Choose a password</h1>
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <SignedIn />
        </Suspense>
      </div>
    </div>
  );
}

async function SignedIn() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?error=link');
  return (
    <>
      <p className="muted">Signed in as {user.email}.</p>
      <PasswordForm />
    </>
  );
}
