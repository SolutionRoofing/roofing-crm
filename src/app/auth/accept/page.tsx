import type { Metadata } from 'next';
import { Icon } from '@/components/icon';
import { AcceptInvite } from './accept';

export const metadata: Metadata = { title: 'Welcome' };

export default function AcceptPage() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand"><span className="brand-mark" style={{ color: '#fff' }}><Icon name="roof" /></span>Roofing CRM</div>
        <h1>Welcome</h1>
        <AcceptInvite />
      </div>
    </div>
  );
}
