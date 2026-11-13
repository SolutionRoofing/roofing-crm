import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ConfirmButton, SubmitButton } from '@/components/client';
import { isAdmin, requireUser, ROLE_LABELS } from '@/lib/auth';
import { PLAN_LIMITS, WARN_AT } from '@/lib/plan-limits';
import { createClient } from '@/lib/supabase/server';
import { deleteCatalogItem, saveCatalogItem } from './actions';
import { deleteEstimateTemplate } from '../documents/actions';
import { CompanyForm, PriceImportForm, ProfileForm } from './forms';

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

type Item = { id: string; name: string; description: string; unit: string; price: number; material_cost: number; labor_cost: number; markup: number; category: string; formula: string };
type Template = { id: string; name: string; items: unknown[]; created_by: string | null };

async function Settings() {
  const me = await requireUser();
  const admin = isAdmin(me);
  const supabase = await createClient();
  const [{ data: profile }, { data: settings }, { data: catalog }, { data: templates }] = await Promise.all([
    supabase.from('profiles').select('full_name, phone, email').eq('id', me.id).single(),
    admin ? supabase.from('settings').select('*').eq('id', 1).single() : Promise.resolve({ data: null }),
    admin ? supabase.from('catalog_items').select('id, name, description, unit, price, material_cost, labor_cost, markup, category, formula').order('category').order('sort').order('name') : Promise.resolve({ data: null }),
    me.role === 'crew' ? Promise.resolve({ data: null }) : supabase.from('estimate_templates').select('id, name, items, created_by').order('name'),
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
      {admin && (
        <Suspense fallback={null}>
          <PlanUsage />
        </Suspense>
      )}
      {catalog && (
        <section className="panel" id="price-list" style={{ marginTop: 14 }}>
          <div className="panel-head"><h2>Price list</h2><span className="muted">Products &amp; services for estimates</span></div>
          <p className="muted" style={{ marginBottom: 10 }}>
            Enter material and labor cost per unit and a markup, and the price works itself out (material cost includes the
            {' '}{Number(settings?.material_tax_rate) || 0}% tax you pay). Or leave costs at 0 and type a price.
          </p>
          <details className="add-box" style={{ marginBottom: 12 }}>
            <summary className="btn small">Import from a CSV file</summary>
            <PriceImportForm />
          </details>
          <details className="formula-help">
            <summary className="link-btn">How quantity formulas work</summary>
            <p className="muted">
              &quot;Fill quantities from measurements&quot; in an estimate uses these. Names you can use: <code>sq</code> (roof area in squares),{' '}
              <code>waste</code> (0.14 for 14%), <code>low_sq</code>, <code>steep_sq</code>, <code>eaves</code>, <code>rakes</code>, <code>ridges</code>,{' '}
              <code>hips</code>, <code>valleys</code>, <code>step</code>, <code>wall</code> (all in feet), <code>pipes</code>, <code>layers</code>, and labor bands{' '}
              <code>p_low</code>, <code>p_4_6</code>, <code>p_7_9</code>, <code>p_10_12</code> (squares). Math: + − × ÷ ( ) and <code>ceil</code>, <code>round</code>,{' '}
              <code>min</code>, <code>max</code>. Leave it empty for items the rep counts by hand.
            </p>
          </details>
          <div className="cat-head" aria-hidden="true">
            <span>Item name</span><span>Category</span><span>UoM</span><span>Material</span><span>Labor</span><span>Markup %</span><span>Price</span><span />
          </div>
          {(catalog as Item[]).map(c => (
            <div className="catalog-row" key={c.id}>
              <CatalogForm c={c} />
              <form action={deleteCatalogItem}>
                <input type="hidden" name="id" value={c.id} />
                <ConfirmButton message={`Remove "${c.name}" from the price list?`} className="icon-btn">×</ConfirmButton>
              </form>
            </div>
          ))}
          <div className="catalog-row add-row"><CatalogForm /></div>
        </section>
      )}
      {templates && (
        <section className="panel" style={{ marginTop: 14 }}>
          <div className="panel-head"><h2>Estimate templates</h2><span className="muted">Made with &quot;Save as template&quot; in the estimate editor</span></div>
          {(templates as Template[]).length === 0 && <p className="muted">No templates yet. Build an estimate and choose Save as template.</p>}
          {(templates as Template[]).map(t => (
            <div className="line-item" key={t.id}>
              <span className="grow"><b>{t.name}</b><small>{t.items.length} line{t.items.length === 1 ? '' : 's'}</small></span>
              {(admin || t.created_by === me.id) && (
                <form action={deleteEstimateTemplate}>
                  <input type="hidden" name="id" value={t.id} />
                  <ConfirmButton message={`Delete the template "${t.name}"?`} className="icon-btn">×</ConfirmButton>
                </form>
              )}
            </div>
          ))}
        </section>
      )}
    </>
  );
}

type Usage = { db_bytes: number; storage_bytes: number; emails_today: number; emails_month: number };

function mb(bytes: number) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

// Admins only: how close the free plans are to their limits (see UPGRADES.md).
async function PlanUsage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc('plan_usage');
  if (!data) return null;
  const u = data as Usage;
  const rows = [
    { label: 'Photo storage', used: u.storage_bytes, limit: PLAN_LIMITS.storageBytes, show: mb, fix: 'Supabase Pro' },
    { label: 'Database', used: u.db_bytes, limit: PLAN_LIMITS.dbBytes, show: mb, fix: 'Supabase Pro' },
    { label: 'Emails today', used: u.emails_today, limit: PLAN_LIMITS.emailsPerDay, show: String, fix: 'Resend Pro' },
    { label: 'Emails this month', used: u.emails_month, limit: PLAN_LIMITS.emailsPerMonth, show: String, fix: 'Resend Pro' },
  ];
  const near = rows.filter(r => r.used / r.limit >= WARN_AT);
  return (
    <section className="panel" style={{ marginTop: 14 }}>
      <div className="panel-head"><h2>Plan usage</h2><span className="muted">Free plans</span></div>
      {near.length > 0 && (
        <p className="usage-warn" role="alert">
          Getting close to a free limit: {near.map(r => `${r.label} (upgrade: ${r.fix})`).join(', ')}. See UPGRADES.md.
        </p>
      )}
      <div className="bars usage-bars">
        {rows.map(r => {
          const pct = Math.min(100, Math.round((r.used / r.limit) * 100));
          return (
            <div className="bar-row" key={r.label}>
              <span className="bar-label">{r.label}</span>
              <span className="bar-track usage-track" title={`${pct}%`}>
                <span className={`bar-fill${r.used / r.limit >= WARN_AT ? ' usage-hot' : ''}`} style={{ width: `${Math.max(pct, 1)}%` }} />
              </span>
              <span className="bar-val">{r.show(r.used)} / {r.show(r.limit)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** One price list row (or the "add" row when no item is given). */
function CatalogForm({ c }: { c?: Item }) {
  const n = c ? c.name : 'new item';
  return (
    <form action={saveCatalogItem} className="cat-form">
      {c && <input type="hidden" name="id" value={c.id} />}
      <input name="name" defaultValue={c?.name} placeholder={c ? '' : 'New item, e.g. Chimney flashing'} aria-label={`Item name for ${n}`} required />
      <input name="category" defaultValue={c?.category} placeholder={c ? "" : "Roofing"} aria-label={`Category for ${n}`} />
      <input name="unit" defaultValue={c?.unit} placeholder="EA" aria-label={`Unit for ${n}`} />
      <input name="material_cost" defaultValue={c ? Number(c.material_cost).toFixed(2) : ''} placeholder="0.00" inputMode="decimal" aria-label={`Material cost for ${n}`} />
      <input name="labor_cost" defaultValue={c ? Number(c.labor_cost).toFixed(2) : ''} placeholder="0.00" inputMode="decimal" aria-label={`Labor cost for ${n}`} />
      <input name="markup" defaultValue={c && (Number(c.material_cost) + Number(c.labor_cost) > 0) ? String(Number(c.markup)) : ''} placeholder="—" inputMode="decimal" aria-label={`Markup percent for ${n}`} />
      <input name="price" defaultValue={c ? Number(c.price).toFixed(2) : ''} placeholder="0.00" inputMode="decimal" aria-label={`Price for ${n}`} />
      <SubmitButton className={`btn small${c ? '' : ' primary'}`} pendingText="…">{c ? 'Save' : 'Add'}</SubmitButton>
      <textarea name="description" defaultValue={c?.description} rows={1} placeholder="Description shown on the estimate (optional)" aria-label={`Description for ${n}`} className="cat-desc" />
      <input name="formula" defaultValue={c?.formula} placeholder="Quantity formula, e.g. ceil((eaves + rakes) / 116)" aria-label={`Quantity formula for ${n}`} className="cat-formula" spellCheck={false} />
    </form>
  );
}
