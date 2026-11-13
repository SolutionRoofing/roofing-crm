import { Suspense } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Icon } from '@/components/icon';
import { isAdmin, requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/form';
import { cleanSelections, cleanUpgrades, docLabel, normalizeLines, normalizeOptions, type CatalogItem, type EstimateTemplate } from '@/lib/documents';
import { DocEditor } from '../../editor';
import { cleanMeasurements } from '@/lib/measure';

export const metadata: Metadata = { title: 'Edit' };

export default function EditDocumentPage({ params }: PageProps<'/documents/[id]/edit'>) {
  return (
    <Suspense fallback={<div className="panel muted">Loading…</div>}>
      <Edit params={params} />
    </Suspense>
  );
}

async function Edit({ params }: { params: PageProps<'/documents/[id]/edit'>['params'] }) {
  const me = await requireUser(['owner', 'office', 'rep']);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: d } = await supabase.from('documents')
    .select('id, kind, number, status, job_id, items, options, upgrades, selections, tax_rate, material_tax_rate, notes, internal_notes, date, due_date, signed_at, jobs(number, name, measurements)')
    .eq('id', id).maybeSingle();
  if (!d) notFound();
  // Signed or decided estimates are final; send people back to the document.
  if (d.signed_at || (d.kind === 'estimate' && ['accepted', 'declined', 'void'].includes(d.status))) redirect(`/documents/${id}`);
  const [{ data: catalog }, { data: templates }] = await Promise.all([
    supabase.from('catalog_items').select('id, name, description, unit, price, material_cost, labor_cost, markup, category, formula').order('sort').order('name'),
    d.kind === 'estimate' ? supabase.from('estimate_templates').select('id, name, items, notes, options, upgrades, selections').order('name') : Promise.resolve({ data: [] }),
  ]);
  const job = d.jobs as unknown as { number: number; name: string; measurements: unknown };

  return (
    <>
      <Link className="crumb" href={`/documents/${id}`}><Icon name="back" size={14} /> {docLabel(d)}</Link>
      <div className="page-head"><h1>Edit {docLabel(d)}</h1><span className="muted">Job #{job.number} {job.name}</span></div>
      <DocEditor
        catalog={(catalog ?? []) as CatalogItem[]}
        templates={((templates ?? []) as EstimateTemplate[]).map(t => ({
          ...t, items: normalizeLines(t.items), options: normalizeOptions(t.options), upgrades: cleanUpgrades(t.upgrades), selections: cleanSelections(t.selections),
        }))}
        canSaveProducts={isAdmin(me)}
        cancelHref={`/documents/${d.id}`}
        measurements={cleanMeasurements(job.measurements)}
        initial={{
          id: d.id, kind: d.kind, job_id: d.job_id, items: normalizeLines(d.items), tax_rate: Number(d.tax_rate),
          material_tax_rate: Number(d.material_tax_rate), notes: d.notes,
          options: normalizeOptions(d.options), upgrades: cleanUpgrades(d.upgrades), selections: cleanSelections(d.selections), internal_notes: d.internal_notes ?? '', date: d.date, due_date: d.due_date,
        }}
      />
    </>
  );
}
