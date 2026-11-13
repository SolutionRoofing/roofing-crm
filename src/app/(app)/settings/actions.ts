'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { markupFor, priceFor } from '@/lib/documents';
import { toPriceRows } from '@/lib/price-import';
import { formulaError } from '@/lib/measure';
import { createClient } from '@/lib/supabase/server';
import { number, text } from '@/lib/form';
import type { FormState } from '@/app/login/actions';

export async function saveMyProfile(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  const fullName = text(fd, 'full_name', 120);
  if (!fullName) return { error: 'Enter your name.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_my_profile', { p_full_name: fullName, p_phone: text(fd, 'phone', 40) });
  if (error) return { error: error.message };
  revalidatePath('/', 'layout');
  return { ok: 'Saved.' };
}

/** Price list rows used by the estimate editor. Owner/office only (enforced by the database too). */
export async function saveCatalogItem(fd: FormData) {
  await requireUser(['owner', 'office']);
  const id = String(fd.get('id') ?? '');
  const name = text(fd, 'name', 200);
  if (!name) return;
  const supabase = await createClient();
  const { data: settings } = await supabase.from('settings').select('material_tax_rate').eq('id', 1).maybeSingle();
  const matTax = Number(settings?.material_tax_rate) || 0;
  const money = (k: string) => Math.max(0, Math.round(number(fd, k) * 100) / 100);
  const costs = { mat: money('material_cost'), lab: money('labor_cost') };
  const markupTyped = String(fd.get('markup') ?? '').trim() !== '';
  let price = money('price');
  let markup = Math.round(number(fd, 'markup') * 100) / 100;
  // With costs filled in, the markup sets the price (as in the estimate editor); with no markup, the price sets it.
  if (costs.mat + costs.lab > 0) {
    if (markupTyped) price = priceFor({ ...costs, markup }, matTax);
    else markup = markupFor(price, costs, matTax);
  }
  const formula = text(fd, 'formula', 300);
  const bad = formulaError(formula);
  if (bad) throw new Error(`The quantity formula for "${name}" has a problem: ${bad}`);
  const row = {
    name, description: text(fd, 'description', 4000), unit: text(fd, 'unit', 12) || 'EA', category: text(fd, 'category', 60),
    material_cost: costs.mat, labor_cost: costs.lab, markup, price, formula,
  };
  const { error } = id
    ? await supabase.from('catalog_items').update(row).eq('id', id)
    : await supabase.from('catalog_items').insert({ ...row, sort: 1000 });
  if (error) throw new Error(error.message);
  revalidatePath('/settings');
}

export async function deleteCatalogItem(fd: FormData) {
  await requireUser(['owner', 'office']);
  const id = String(fd.get('id') ?? '');
  if (!id) return;
  const supabase = await createClient();
  const { error } = await supabase.from('catalog_items').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/settings');
}

/** Company details used on estimates, invoices and in emails. Owner/office only. */
export async function saveCompany(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireUser(['owner', 'office']);
  const company = text(fd, 'company', 120);
  if (!company) return { error: 'Enter the company name.' };
  const taxRate = number(fd, 'tax_rate');
  if (taxRate < 0 || taxRate > 25) return { error: 'Sales tax should be a percentage between 0 and 25.' };
  const materialTax = number(fd, 'material_tax_rate');
  if (materialTax < 0 || materialTax > 25) return { error: 'Material tax should be a percentage between 0 and 25.' };
  const supabase = await createClient();
  const { error, count } = await supabase.from('settings').update({
    company, phone: text(fd, 'phone', 40), email: text(fd, 'email', 200), address: text(fd, 'address', 300),
    license: text(fd, 'license', 80), tax_rate: taxRate, material_tax_rate: materialTax, review_url: text(fd, 'review_url', 500), terms: text(fd, 'terms', 4000),
  }, { count: 'exact' }).eq('id', 1);
  if (error) return { error: error.message };
  if (!count) return { error: 'Only an owner or office manager can change company settings.' };
  revalidatePath('/', 'layout');
  return { ok: 'Company details saved.' };
}

/**
 * Import a price list CSV (JobNimbus Products & Services export, ABC price sheet, any spreadsheet).
 * Items are matched by name: existing ones are updated, new ones added. Optionally replaces the whole list.
 */
export async function importPriceList(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireUser(['owner', 'office']);
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a CSV file to import.' };
  if (file.size > 3 * 1024 * 1024) return { error: 'That file is over 3 MB. Save just the item columns as CSV and try again.' };
  if (!/\.(csv|txt)$/i.test(file.name)) return { error: 'Save the spreadsheet as CSV (File → Save as → CSV) and import that file.' };
  const supabase = await createClient();
  const { data: settings } = await supabase.from('settings').select('material_tax_rate').eq('id', 1).maybeSingle();
  const { rows, skipped, error } = toPriceRows(await file.text(), Number(settings?.material_tax_rate) || 0);
  if (error) return { error };
  if (!rows.length) return { error: 'No items found in that file.' };

  const replace = fd.get('replace') === 'on';
  const { data: existing, error: e1 } = await supabase.from('catalog_items').select('id, name');
  if (e1) return { error: e1.message };
  const byName = new Map((existing ?? []).map(c => [c.name.trim().toLowerCase(), c.id as string]));
  const updates = rows.filter(r => byName.has(r.name.toLowerCase()));
  const inserts = rows.filter(r => !byName.has(r.name.toLowerCase())).map((r, i) => ({ ...r, sort: 2000 + i }));

  for (const r of updates) {
    const { error: e } = await supabase.from('catalog_items').update(r).eq('id', byName.get(r.name.toLowerCase())!);
    if (e) return { error: `"${r.name}": ${e.message}` };
  }
  for (let i = 0; i < inserts.length; i += 200) {
    const { error: e } = await supabase.from('catalog_items').insert(inserts.slice(i, i + 200));
    if (e) return { error: e.message };
  }
  let removed = 0;
  if (replace) {
    const keep = new Set(rows.map(r => r.name.toLowerCase()));
    const drop = (existing ?? []).filter(c => !keep.has(c.name.trim().toLowerCase())).map(c => c.id as string);
    if (drop.length) {
      const { error: e } = await supabase.from('catalog_items').delete().in('id', drop);
      if (e) return { error: e.message };
      removed = drop.length;
    }
  }
  revalidatePath('/settings');
  const parts = [`${inserts.length} added`, `${updates.length} updated`];
  if (removed) parts.push(`${removed} removed`);
  if (skipped) parts.push(`${skipped} skipped (hidden, duplicate or no name)`);
  return { ok: `Price list imported: ${parts.join(', ')}.` };
}
