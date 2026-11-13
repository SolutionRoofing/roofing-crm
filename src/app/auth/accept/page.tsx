import type { Metadata } from 'next';
import { Logo, Tagline } from '@/components/logo';
import { AcceptInvite } from './accept';

export const metadata: Metadata = { title: 'Welcome' };

export default function AcceptPage() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo"><Logo height={120} /></div>
        <h1>Welcome</h1>
        <AcceptInvite />
      </div>
      <Tagline className="auth-tagline" />
    </div>
  );
}
