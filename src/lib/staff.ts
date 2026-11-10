import 'server-only';
import { createClient } from '@/lib/supabase/server';

export type Person = { id: string; full_name: string; email: string; role: string };
export type Crew = { id: string; name: string };

/** Active staff (for rep / assignee pickers) and crews. Staff-only data; RLS returns nothing to crews. */
export async function getPeople() {
  const supabase = await createClient();
  const [{ data: people }, { data: crews }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email, role').eq('active', true).neq('role', 'crew').order('full_name'),
    supabase.from('crews').select('id, name').eq('active', true).order('name'),
  ]);
  return { people: (people ?? []) as Person[], crews: (crews ?? []) as Crew[] };
}

export const personName = (p: Person) => p.full_name || p.email;
