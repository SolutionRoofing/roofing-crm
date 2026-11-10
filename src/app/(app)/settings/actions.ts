'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
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

/** Company details used on estimates, invoices and in emails. Owner/office only. */
export async function saveCompany(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireUser(['owner', 'office']);
  const company = text(fd, 'company', 120);
  if (!company) return { error: 'Enter the company name.' };
  const taxRate = number(fd, 'tax_rate');
  if (taxRate < 0 || taxRate > 25) return { error: 'Tax rate should be a percentage between 0 and 25.' };
  const supabase = await createClient();
  const { error, count } = await supabase.from('settings').update({
    company, phone: text(fd, 'phone', 40), email: text(fd, 'email', 200), address: text(fd, 'address', 300),
    license: text(fd, 'license', 80), tax_rate: taxRate, review_url: text(fd, 'review_url', 500), terms: text(fd, 'terms', 4000),
  }, { count: 'exact' }).eq('id', 1);
  if (error) return { error: error.message };
  if (!count) return { error: 'Only an owner or office manager can change company settings.' };
  revalidatePath('/', 'layout');
  return { ok: 'Company details saved.' };
}
