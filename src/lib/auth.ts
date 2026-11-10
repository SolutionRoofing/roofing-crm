import 'server-only';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { cache } from 'react';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

export type Role = 'owner' | 'office' | 'rep' | 'crew';

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  office: 'Office',
  rep: 'Sales rep',
  crew: 'Crew',
};

export type CurrentUser = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  crewId: string | null;
  active: boolean;
};

export const isStaff = (u: CurrentUser) => u.active && u.role !== 'crew';
export const isAdmin = (u: CurrentUser) => u.active && (u.role === 'owner' || u.role === 'office');

/** The signed-in user and their profile, or null when signed out. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  // Session reads are per request; say so before Supabase touches the clock.
  await connection();
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: p } = await supabase
    .from('profiles')
    .select('full_name, email, role, crew_id, active')
    .eq('id', data.user.id)
    .maybeSingle();
  return {
    id: data.user.id,
    email: p?.email || data.user.email || '',
    fullName: p?.full_name || '',
    role: (p?.role as Role) ?? 'rep',
    crewId: p?.crew_id ?? null,
    active: Boolean(p?.active),
  };
});

/**
 * Requires an active, signed-in user, optionally with one of the given roles.
 * Crews sent to a staff page land on their work orders.
 */
export async function requireUser(roles?: Role[]): Promise<CurrentUser> {
  if (!isSupabaseConfigured()) redirect('/setup');
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!user.active) redirect('/login?inactive=1');
  if (roles && !roles.includes(user.role)) redirect(user.role === 'crew' ? '/work-orders' : '/dashboard');
  return user;
}
