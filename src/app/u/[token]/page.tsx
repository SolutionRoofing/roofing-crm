import { Suspense } from 'react';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLIC_KEY, SUPABASE_URL } from '@/lib/env';
import { Logo } from '@/components/logo';

// Unsubscribe page linked from every marketing email. No login; the token is checked in the database.
export const metadata: Metadata = { title: 'Unsubscribe', robots: { index: false, follow: false } };

const anon = () => createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, { auth: { persistSession: false } });

async function unsubscribe(fd: FormData) {
  'use server';
  const token = String(fd.get('token') ?? '').slice(0, 100);
  await anon().rpc('unsubscribe_contact', { p_token: token });
  revalidatePath(`/u/${token}`);
}

export default function UnsubscribePage({ params }: PageProps<'/u/[token]'>) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo"><Logo height={110} /></div>
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <Body params={params} />
        </Suspense>
      </div>
    </div>
  );
}

async function Body({ params }: { params: PageProps<'/u/[token]'>['params'] }) {
  await connection();
  const { token } = await params;
  const { data } = await anon().rpc('unsubscribe_info', { p_token: token });
  const info = data as { company: string; email: string; unsubscribed: boolean } | null;
  if (!info) return <><h1>Link not valid</h1><p className="muted" style={{ marginTop: 6 }}>This unsubscribe link isn&apos;t valid. Reply to the email and we&apos;ll take you off the list.</p></>;
  if (info.unsubscribed) {
    return (
      <>
        <h1>You&apos;re unsubscribed</h1>
        <p className="muted" style={{ marginTop: 6 }}>{info.email} won&apos;t get marketing emails from {info.company} anymore. You may still hear from us about a job you have with us.</p>
      </>
    );
  }
  return (
    <>
      <h1>Unsubscribe</h1>
      <p className="muted" style={{ marginTop: 6 }}>Stop marketing emails from {info.company} to {info.email}?</p>
      <form action={unsubscribe}>
        <input type="hidden" name="token" value={token} />
        <button className="btn primary">Unsubscribe</button>
      </form>
    </>
  );
}
