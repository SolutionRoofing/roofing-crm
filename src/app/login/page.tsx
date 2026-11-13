import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Logo, Tagline } from '@/components/logo';
import { safeNext } from '@/lib/safe-next';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

const NOTICES: Record<string, string> = {
  inactive: 'Your account is waiting for an owner or office manager to give you access.',
  link: 'That link has expired or was already used. Ask for a new invite, or reset your password below.',
};

export default function LoginPage({ searchParams }: PageProps<'/login'>) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo"><Logo height={120} /></div>
        <h1>Sign in</h1>
        <p className="muted">Use the email your office invited you with.</p>
        <Suspense fallback={null}>
          <Form searchParams={searchParams} />
        </Suspense>
      </div>
      <Tagline className="auth-tagline" />
    </div>
  );
}

async function Form({ searchParams }: { searchParams: PageProps<'/login'>['searchParams'] }) {
  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const notice = pick('inactive') ? NOTICES.inactive : pick('error') === 'link' ? NOTICES.link : undefined;
  return <LoginForm next={safeNext(pick('next')) ?? '/'} notice={notice} />;
}
