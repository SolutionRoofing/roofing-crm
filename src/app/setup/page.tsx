import type { Metadata } from 'next';
import { Logo } from '@/components/logo';

export const metadata: Metadata = { title: 'Connect Supabase' };

// Shown until .env.local has the Supabase settings (see SETUP.md).
export default function SetupPage() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo"><Logo height={120} /></div>
        <h1>Almost there</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          The app isn&apos;t connected to its database yet. Copy <code>.env.example</code> to <code>.env.local</code>,
          fill in the Supabase project URL and keys, then restart the app. SETUP.md walks through it.
        </p>
      </div>
    </div>
  );
}
