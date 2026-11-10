import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Icon } from '@/components/icon';
import { ConfirmButton, SubmitButton } from '@/components/client';
import { ContactFields } from '@/components/contact-fields';
import { isAdmin, requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/form';
import { JOB_LIST_COLUMNS, StageBadge, type JobRow } from '@/lib/jobs';
import { fmtDateTime, fullAddress, fullName, mapHref, money, telHref } from '@/lib/format';
import { deleteContact, updateContact } from '../actions';

export const metadata: Metadata = { title: 'Customer' };

export default function ContactPage({ params }: PageProps<'/contacts/[id]'>) {
  return (
    <>
      <Link className="crumb" href="/contacts"><Icon name="back" size={14} /> Customers</Link>
      <Suspense fallback={<div className="panel muted">Loading…</div>}>
        <Contact params={params} />
      </Suspense>
    </>
  );
}

async function Contact({ params }: { params: PageProps<'/contacts/[id]'>['params'] }) {
  const me = await requireUser(['owner', 'office', 'rep']);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const [{ data: c }, { data: jobs }, { data: emails }] = await Promise.all([
    supabase.from('contacts').select('*').eq('id', id).maybeSingle(),
    supabase.from('job_list').select(JOB_LIST_COLUMNS).eq('contact_id', id).order('number', { ascending: false }).returns<JobRow[]>(),
    supabase.from('outbox').select('id, subject, status, send_at, sent_at').eq('contact_id', id).order('send_at', { ascending: false }).limit(20),
  ]);
  if (!c) notFound();
  const address = fullAddress(c);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{fullName(c)}</h1>
          <p className="muted" style={{ marginTop: 4 }}>{[c.source, address].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="quick" style={{ margin: 0 }}>
          {c.phone && <a className="btn" href={telHref(c.phone)}><Icon name="phone" size={16} /> Call</a>}
          {c.email && <a className="btn" href={`mailto:${c.email}`}><Icon name="mail" size={16} /> Email</a>}
          {address && <a className="btn" href={mapHref(address)} target="_blank" rel="noreferrer"><Icon name="pin" size={16} /> Map</a>}
          <Link className="btn primary" href={`/jobs/new?contact=${c.id}`}><Icon name="plus" size={16} /> New job</Link>
        </div>
      </div>

      <div className="grid-2">
        <div>
          <section className="panel">
            <div className="panel-head"><h2>Jobs</h2></div>
            {!jobs?.length && <p className="muted">No jobs for this customer.</p>}
            {jobs?.map(j => (
              <Link key={j.id} className="line-item" href={`/jobs/${j.id}`}>
                <span className="grow"><b>#{j.number} {j.name}</b><small>{j.rep_name || 'Unassigned'}</small></span>
                <StageBadge stage={j.stage} />
                <span className="num">{money(j.amount)}</span>
              </Link>
            ))}
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Emails</h2></div>
            {!emails?.length && <p className="muted">No emails queued or sent.</p>}
            {emails?.map(e => (
              <div className="line-item" key={e.id}>
                <span className="grow"><b>{e.subject}</b><small>{fmtDateTime(e.sent_at ?? e.send_at)}</small></span>
                <span className={`badge ${e.status === 'sent' ? 'good' : e.status === 'scheduled' ? 'info' : ''}`}>{e.status}</span>
              </div>
            ))}
          </section>
        </div>
        <section className="panel">
          <div className="panel-head"><h2>Details</h2></div>
          <form action={updateContact} className="form-grid">
            <input type="hidden" name="id" value={c.id} />
            <ContactFields c={c} />
            <div style={{ gridColumn: '1 / -1' }}><SubmitButton>Save customer</SubmitButton></div>
          </form>
        </section>
      </div>

      {isAdmin(me) && (
        <form action={deleteContact}>
          <input type="hidden" name="id" value={c.id} />
          <ConfirmButton message={`Delete ${fullName(c)}? Their jobs stay, but lose the customer link, and queued emails to them are removed. This cannot be undone.`}>Delete customer</ConfirmButton>
        </form>
      )}
    </>
  );
}
