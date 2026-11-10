import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ConfirmButton, SubmitButton } from '@/components/client';
import { isAdmin, requireUser, ROLE_LABELS } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { deleteCatalogItem, saveCatalogItem } from './actions';
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

type Item = { id: string; description: string; unit: string; price: number };

async function Settings() {
  const me = await requireUser();
  const admin = isAdmin(me);
  const supabase = await createClient();
  const [{ data: profile }, { data: settings }, { data: catalog }] = await Promise.all([
    supabase.from('profiles').select('full_name, phone, email').eq('id', me.id).single(),
    admin ? supabase.from('settings').select('*').eq('id', 1).single() : Promise.resolve({ data: null }),
    admin ? supabase.from('catalog_items').select('id, description, unit, price').order('sort').order('description') : Promise.resolve({ data: null }),
  ]);

  return (
    <>
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
      {catalog && (
        <section className="panel" id="price-list" style={{ marginTop: 14 }}>
          <div className="panel-head"><h2>Price list</h2><span className="muted">Used when building estimates</span></div>
          <p className="muted" style={{ marginBottom: 8 }}>The starter prices are placeholders. Replace them with your own.</p>
          {(catalog as Item[]).map(c => (
            <div className="catalog-row" key={c.id}>
              <form action={saveCatalogItem} className="inline-form">
                <input type="hidden" name="id" value={c.id} />
                <input name="description" defaultValue={c.description} aria-label="Description" className="grow-input" required />
                <input name="unit" defaultValue={c.unit} aria-label="Unit" style={{ width: 64 }} />
                <input name="price" defaultValue={Number(c.price).toFixed(2)} inputMode="decimal" aria-label="Price" style={{ width: 96 }} />
                <SubmitButton className="btn small" pendingText="…">Save</SubmitButton>
              </form>
              <form action={deleteCatalogItem}>
                <input type="hidden" name="id" value={c.id} />
                <ConfirmButton message={`Remove "${c.description}" from the price list?`} className="icon-btn">×</ConfirmButton>
              </form>
            </div>
          ))}
          <form action={saveCatalogItem} className="inline-form add-row">
            <input name="description" placeholder="New item, e.g. Chimney flashing" aria-label="New item description" className="grow-input" required />
            <input name="unit" placeholder="EA" aria-label="New item unit" style={{ width: 64 }} />
            <input name="price" placeholder="0.00" inputMode="decimal" aria-label="New item price" style={{ width: 96 }} />
            <SubmitButton className="btn small primary" pendingText="Adding…">Add</SubmitButton>
          </form>
        </section>
      )}
    </>
  );
}
