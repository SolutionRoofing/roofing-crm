import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Icon } from '@/components/icon';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getPeople, personName } from '@/lib/staff';
import { fullName } from '@/lib/format';
import { isUuid } from '@/lib/form';
import { LeadForm } from './lead-form';

export const metadata: Metadata = { title: 'New lead' };

export default function NewLeadPage({ searchParams }: PageProps<'/jobs/new'>) {
  return (
    <>
      <Link className="crumb" href="/jobs"><Icon name="back" size={14} /> Jobs</Link>
      <div className="page-head"><h1>New lead</h1></div>
      <Suspense fallback={<div className="panel muted">Loading…</div>}>
        <Form searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Form({ searchParams }: { searchParams: PageProps<'/jobs/new'>['searchParams'] }) {
  const me = await requireUser(['owner', 'office', 'rep']);
  const contactParam = (await searchParams).contact;
  const supabase = await createClient();
  const [{ data: contacts }, { people }] = await Promise.all([
    supabase.from('contacts').select('id, first, last, address').order('last').order('first').limit(2000),
    getPeople(),
  ]);
  const defaultContact = typeof contactParam === 'string' && isUuid(contactParam) ? contactParam : '';
  return (
    <LeadForm
      contacts={(contacts ?? []).map(c => ({ id: c.id, label: `${fullName(c)}${c.address ? ` · ${c.address}` : ''}` }))}
      reps={people.map(p => ({ id: p.id, label: personName(p) }))}
      defaultContact={defaultContact}
      defaultRep={me.role === 'rep' ? me.id : ''}
    />
  );
}
