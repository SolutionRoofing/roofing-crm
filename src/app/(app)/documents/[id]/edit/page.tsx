import { Suspense } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Icon } from '@/components/icon';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/form';
import { docLabel, type CatalogItem, type Line } from '@/lib/documents';
import { DocEditor } from '../../editor';

export const metadata: Metadata = { title: 'Edit' };

export default function EditDocumentPage({ params }: PageProps<'/documents/[id]/edit'>) {
  return (
    <Suspense fallback={<div className="panel muted">Loading…</div>}>
      <Edit params={params} />
    </Suspense>
  );
}

async function Edit({ params }: { params: PageProps<'/documents/[id]/edit'>['params'] }) {
  await requireUser(['owner', 'office', 'rep']);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: d } = await supabase.from('documents')
    .select('id, kind, number, status, job_id, items, tax_rate, notes, date, due_date, signed_at, jobs(number, name, squares)')
    .eq('id', id).maybeSingle();
  if (!d) notFound();
  // Signed or decided estimates are final; send people back to the document.
  if (d.signed_at || (d.kind === 'estimate' && ['accepted', 'declined', 'void'].includes(d.status))) redirect(`/documents/${id}`);
  const { data: catalog } = await supabase.from('catalog_items').select('id, description, unit, price').order('sort');
  const job = d.jobs as unknown as { number: number; name: string; squares: number };

  return (
    <>
      <Link className="crumb" href={`/documents/${id}`}><Icon name="back" size={14} /> {docLabel(d)}</Link>
      <div className="page-head"><h1>Edit {docLabel(d)}</h1><span className="muted">Job #{job.number} {job.name}</span></div>
      <DocEditor
        catalog={(catalog ?? []) as CatalogItem[]}
        squares={Number(job.squares) || 0}
        initial={{ id: d.id, kind: d.kind, job_id: d.job_id, items: d.items as Line[], tax_rate: Number(d.tax_rate), notes: d.notes, date: d.date, due_date: d.due_date }}
      />
    </>
  );
}
