import { Suspense } from 'react';
import type { Metadata } from 'next';
import { isAdmin, requireUser, ROLE_LABELS } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { CompanyForm, ProfileForm } from './forms';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <>
      <div className="page-head"><h1>Settings</h1></div>
      <Suspense fallback={<div className="panel muted">Loading…</div>}>
        <Settings />
      </Suspense>
    </>
  );
}

async function Settings() {
  const me = await requireUser();
  const supabase = await createClient();
  const [{ data: profile }, { data: settings }] = await Promise.all([
    supabase.from('profiles').select('full_name, phone, email').eq('id', me.id).single(),
    isAdmin(me) ? supabase.from('settings').select('*').eq('id', 1).single() : Promise.resolve({ data: null }),
  ]);

  return (
    <div className="grid-2">
      <section className="panel">
        <div className="panel-head"><h2>Your profile</h2><span className="badge">{ROLE_LABELS[me.role]}</span></div>
        <ProfileForm fullName={profile?.full_name ?? ''} phone={profile?.phone ?? ''} email={profile?.email || me.email} />
      </section>
      {settings && (
        <section className="panel">
          <div className="panel-head"><h2>Company</h2></div>
          <CompanyForm s={settings} />
        </section>
      )}
    </div>
  );
}
