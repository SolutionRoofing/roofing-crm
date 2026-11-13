'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { markupFor, priceFor } from '@/lib/documents';
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
  const row = {
    name, description: text(fd, 'description', 4000), unit: text(fd, 'unit', 12) || 'EA', category: text(fd, 'category', 60),
    material_cost: costs.mat, labor_cost: costs.lab, markup, price,
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
