import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Icon } from '@/components/icon';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/form';
import { addDaysISO, todayISO } from '@/lib/format';
import type { CatalogItem } from '@/lib/documents';
import { DocEditor } from '../editor';

export const metadata: Metadata = { title: 'New estimate' };

export default function NewDocumentPage({ searchParams }: PageProps<'/documents/new'>) {
  return (
    <Suspense fallback={<div className="panel muted">Loading…</div>}>
      <New searchParams={searchParams} />
    </Suspense>
  );
}

async function New({ searchParams }: { searchParams: PageProps<'/documents/new'>['searchParams'] }) {
  await requireUser(['owner', 'office', 'rep']);
  const sp = await searchParams;
  const jobId = typeof sp.job === 'string' && isUuid(sp.job) ? sp.job : null;
  const kind = sp.kind === 'invoice' ? 'invoice' : 'estimate';
  if (!jobId) notFound();
  const supabase = await createClient();
  const [{ data: job }, { data: catalog }, { data: settings }] = await Promise.all([
    supabase.from('jobs').select('id, number, name, squares').eq('id', jobId).maybeSingle(),
    supabase.from('catalog_items').select('id, description, unit, price').order('sort'),
    supabase.from('settings').select('tax_rate').maybeSingle(),
  ]);
  if (!job) notFound();
  const today = todayISO();
  return (
    <>
      <Link className="crumb" href={`/jobs/${job.id}#money`}><Icon name="back" size={14} /> Job #{job.number} {job.name}</Link>
      <div className="page-head"><h1>New {kind}</h1></div>
      <DocEditor
        catalog={(catalog ?? []) as CatalogItem[]}
        squares={Number(job.squares) || 0}
        initial={{ kind, job_id: job.id, items: [], tax_rate: Number(settings?.tax_rate) || 0, notes: '', date: today, due_date: kind === 'invoice' ? addDaysISO(today, 14) : null }}
      />
    </>
  );
}
