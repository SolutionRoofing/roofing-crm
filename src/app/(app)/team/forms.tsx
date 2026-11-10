'use client';

import { useActionState, useState } from 'react';
import type { FormState } from '@/app/login/actions';
import { addCrew, inviteMember } from './actions';

type Crew = { id: string; name: string };

export function InviteForm({ crews, canInviteOwner }: { crews: Crew[]; canInviteOwner: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(inviteMember, {});
  const [role, setRole] = useState('rep');
  return (
    <form action={action} className="form-grid">
      {state.error && <p className="form-error" style={{ gridColumn: '1 / -1' }} role="alert">{state.error}</p>}
      {state.ok && <p className="form-ok" style={{ gridColumn: '1 / -1' }} role="status">{state.ok}</p>}
      <div className="field"><label htmlFor="inv-name">Name</label><input id="inv-name" name="full_name" required /></div>
      <div className="field"><label htmlFor="inv-email">Email</label><input id="inv-email" name="email" type="email" required /></div>
      <div className="field">
        <label htmlFor="inv-role">Role</label>
        <select id="inv-role" name="role" value={role} onChange={e => setRole(e.target.value)}>
          <option value="rep">Sales rep: all jobs, no settings</option>
          <option value="office">Office: everything except owners</option>
          {canInviteOwner && <option value="owner">Owner: everything</option>}
          <option value="crew">Crew: own work orders, no prices</option>
        </select>
      </div>
      {role === 'crew' && (
        <div className="field">
          <label htmlFor="inv-crew">Crew</label>
          <select id="inv-crew" name="crew_id" required defaultValue="">
            <option value="" disabled>{crews.length ? 'Pick a crew' : 'Add a crew first'}</option>
            {crews.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      <div style={{ gridColumn: '1 / -1' }}>
        <button className="btn primary" disabled={pending}>{pending ? 'Sending…' : 'Send invite'}</button>
      </div>
    </form>
  );
}

export function CrewForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(addCrew, {});
  return (
    <form action={action} className="form-grid">
      {state.error && <p className="form-error" style={{ gridColumn: '1 / -1' }} role="alert">{state.error}</p>}
      {state.ok && <p className="form-ok" style={{ gridColumn: '1 / -1' }} role="status">{state.ok}</p>}
      <div className="field"><label htmlFor="crew-name">Crew name</label><input id="crew-name" name="name" required placeholder="e.g. Martinez Roofing" /></div>
      <div className="field"><label htmlFor="crew-lead">Crew lead</label><input id="crew-lead" name="lead_name" /></div>
      <div className="field"><label htmlFor="crew-phone">Phone</label><input id="crew-phone" name="phone" type="tel" /></div>
      <div style={{ gridColumn: '1 / -1' }}>
        <button className="btn" disabled={pending}>{pending ? 'Adding…' : 'Add crew'}</button>
      </div>
    </form>
  );
}
