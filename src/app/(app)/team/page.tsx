import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requireUser, ROLE_LABELS, type Role } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { updateMember } from './actions';
import { CrewForm, InviteForm } from './forms';

export const metadata: Metadata = { title: 'Team' };

type Profile = { id: string; full_name: string; email: string; role: Role; crew_id: string | null; active: boolean };
type Crew = { id: string; name: string; lead_name: string; phone: string };

export default function TeamPage() {
  return (
    <>
      <div className="page-head"><h1>Team and crews</h1></div>
      <Suspense fallback={<div className="panel muted">Loading…</div>}>
        <Team />
      </Suspense>
    </>
  );
}

async function Team() {
  const me = await requireUser(['owner', 'office']);
  const supabase = await createClient();
  const [{ data: people }, { data: crews }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email, role, crew_id, active').order('full_name').returns<Profile[]>(),
    supabase.from('crews').select('id, name, lead_name, phone').order('name').returns<Crew[]>(),
  ]);
  const crewName = new Map((crews ?? []).map(c => [c.id, c.name]));

  return (
    <>
      <section className="panel flush">
        <div className="panel-head pad"><h2>People with a login</h2></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Role and access</th></tr></thead>
            <tbody>
              {(people ?? []).map(p => {
                const locked = p.id === me.id || (p.role === 'owner' && me.role !== 'owner');
                return (
                  <tr key={p.id}>
                    <td><b>{p.full_name || '(no name)'}</b><small>{p.email}</small></td>
                    <td>
                      {locked ? (
                        <span>
                          {ROLE_LABELS[p.role]}{p.crew_id ? ` · ${crewName.get(p.crew_id) ?? ''}` : ''}
                          {p.id === me.id && <small>That&apos;s you</small>}
                        </span>
                      ) : (
                        <form action={updateMember} className="inline-form">
                          <input type="hidden" name="id" value={p.id} />
                          <select name="role" defaultValue={p.role} aria-label={`Role for ${p.full_name}`}>
                            {(Object.keys(ROLE_LABELS) as Role[])
                              .filter(r => r !== 'owner' || me.role === 'owner')
                              .map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                          </select>
                          <select name="crew_id" defaultValue={p.crew_id ?? ''} aria-label={`Crew for ${p.full_name}`}>
                            <option value="">No crew</option>
                            {(crews ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                          <label><input type="checkbox" name="active" defaultChecked={p.active} /> Has access</label>
                          <button className="btn small">Save</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head"><h2>Invite someone</h2></div>
          <p className="muted" style={{ marginBottom: 12 }}>They get an email with a link to choose a password.</p>
          <InviteForm crews={(crews ?? []).map(c => ({ id: c.id, name: c.name }))} canInviteOwner={me.role === 'owner'} />
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Crews</h2></div>
          {(crews ?? []).map(c => (
            <div className="line-item" key={c.id}>
              <span className="grow"><b>{c.name}</b><small>{[c.lead_name, c.phone].filter(Boolean).join(' · ') || 'No contact details'}</small></span>
            </div>
          ))}
          {!crews?.length && <p className="muted" style={{ marginBottom: 12 }}>Add each subcontractor crew, then invite its lead with the Crew role.</p>}
          <div style={{ marginTop: 12 }}><CrewForm /></div>
        </section>
      </div>
    </>
  );
}
