import { Suspense } from 'react';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { DocSheet, type SheetData } from '@/components/doc-sheet';
import { createClient } from '@/lib/supabase/server';
import { docTotals } from '@/lib/documents';
import { fullName, moneyCents } from '@/lib/format';
import { SignForm } from './sign-form';
import { PrintButton } from '@/app/(app)/documents/doc-client';

// Customer-facing page: no login. Everything goes through the token-checked database function.
export const metadata: Metadata = { title: 'Your document', robots: { index: false, follow: false } };

export default function SharedDocumentPage({ params }: PageProps<'/e/[token]'>) {
  return (
    <div className="public-page">
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Shared params={params} />
      </Suspense>
    </div>
  );
}

async function Shared({ params }: { params: PageProps<'/e/[token]'>['params'] }) {
  await connection();
  const { token } = await params;
  const supabase = await createClient();
  // A signed-in team member previewing the link shouldn't count as the customer opening it.
  const { data: session } = await supabase.auth.getClaims();
  const { data } = await supabase.rpc('get_shared_document', { p_token: token, p_track: !session?.claims });
  const d = data as (SheetData & { total: number }) | null;
  if (!d) {
    return (
      <div className="panel" style={{ maxWidth: 520, margin: '40px auto' }}>
        <h1>Link not available</h1>
        <p className="muted" style={{ marginTop: 6 }}>This link is no longer valid. Please contact the company that sent it to you.</p>
      </div>
    );
  }
  const total = docTotals(d.items, d.tax_rate, d.paid).total;
  const canSign = d.kind === 'estimate' && d.status === 'sent' && !d.signed_at;

  return (
    <>
      <div className="public-bar no-print">
        <span>{d.company.company}{d.company.phone ? ` · ${d.company.phone}` : ''}</span>
        <PrintButton />
      </div>
      <DocSheet d={d} />
      {canSign && <SignForm token={token} defaultName={fullName(d.customer) === 'No customer' ? '' : fullName(d.customer)} total={moneyCents(total)} />}
      {d.kind === 'estimate' && d.status === 'declined' && (
        <p className="panel muted no-print">This estimate was marked declined. Contact us if you&apos;d like to revisit it.</p>
      )}
    </>
  );
}
