'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { requireUser, type Role } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { FormState } from '@/app/login/actions';

const ROLES: Role[] = ['owner', 'office', 'rep', 'crew'];

/** Emails an invite and sets the new person's role. Owner/office only; only owners can invite owners. */
export async function inviteMember(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireUser(['owner', 'office']);
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const fullName = String(formData.get('full_name') ?? '').trim();
  const role = String(formData.get('role') ?? '') as Role;
  const crewId = String(formData.get('crew_id') ?? '') || null;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email address.' };
  if (!fullName) return { error: 'Enter their name.' };
  if (!ROLES.includes(role)) return { error: 'Pick a role.' };
  if (role === 'owner' && me.role !== 'owner') return { error: 'Only an owner can invite another owner.' };
  if (role === 'crew' && !crewId) return { error: 'Pick which crew this login belongs to.' };

  const h = await headers();
  const origin = h.get('origin') ?? `https://${h.get('host')}`;
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo: `${origin}/auth/accept?next=/account/password`,
  });
  if (error || !data.user) {
    return { error: error?.message.includes('already') ? 'That email already has a login.' : `Invite failed: ${error?.message}` };
  }
  const { error: pErr } = await admin.from('profiles')
    .update({ full_name: fullName, role, crew_id: role === 'crew' ? crewId : null, active: true })
    .eq('id', data.user.id);
  if (pErr) return { error: `Invite sent, but setting their role failed: ${pErr.message}` };

  revalidatePath('/team');
  return { ok: `Invite sent to ${email}.` };
}

/** Change a person's role, crew or access. Runs as the signed-in user, so database rules apply. */
export async function updateMember(formData: FormData) {
  await requireUser(['owner', 'office']);
  const id = String(formData.get('id') ?? '');
  const role = String(formData.get('role') ?? '') as Role;
  const crewId = String(formData.get('crew_id') ?? '') || null;
  const active = formData.get('active') === 'on';
  if (!id || !ROLES.includes(role)) return;

  const supabase = await createClient();
  const { error } = await supabase.from('profiles')
    .update({ role, crew_id: role === 'crew' ? crewId : null, active })
    .eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/team');
}

export async function addCrew(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser(['owner', 'office']);
  const name = String(formData.get('name') ?? '').trim();
  const leadName = String(formData.get('lead_name') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  if (!name) return { error: 'Enter a crew name.' };
  const supabase = await createClient();
  const { error } = await supabase.from('crews').insert({ name, lead_name: leadName, phone });
  if (error) return { error: error.message };
  revalidatePath('/team');
  return { ok: `${name} added.` };
}
