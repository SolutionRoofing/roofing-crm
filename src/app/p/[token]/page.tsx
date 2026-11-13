import { Suspense } from 'react';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { CustomerGallery, type SharedPhoto } from './gallery';

// Customer-facing photo page: no login. The token is checked by get_shared_photos, which only
// returns the photos picked for this link; only then are viewing links made for those files.
export const metadata: Metadata = { title: 'Your project photos', robots: { index: false, follow: false } };

type Shared = {
  message: string; created_at: string;
  customer: { first: string | null; address: string | null; city: string | null; st: string | null };
  company: { company: string; phone: string; email: string };
  photos: { id: string; path: string; thumb: string; caption: string; taken_at: string }[];
};

export default function SharedPhotosPage({ params }: PageProps<'/p/[token]'>) {
  return (
    <div className="public-page">
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Photos params={params} />
      </Suspense>
    </div>
  );
}

async function Photos({ params }: { params: PageProps<'/p/[token]'>['params'] }) {
  await connection();
  const { token } = await params;
  const supabase = await createClient();
  // A signed-in team member previewing the link shouldn't count as the customer opening it.
  const { data: session } = await supabase.auth.getClaims();
  const { data } = await supabase.rpc('get_shared_photos', { p_token: token, p_track: !session?.claims });
  const d = data as Shared | null;
  if (!d) {
    return (
      <div className="panel" style={{ maxWidth: 520, margin: '40px auto' }}>
        <h1>Link not available</h1>
        <p className="muted" style={{ marginTop: 6 }}>This link is no longer valid. Please contact the company that sent it to you.</p>
      </div>
    );
  }

  const storage = createAdminClient().storage.from('job-photos');
  const hour = 60 * 60;
  const [view, download] = await Promise.all([
    storage.createSignedUrls([...new Set(d.photos.flatMap(p => [p.path, p.thumb]))], hour),
    storage.createSignedUrls(d.photos.map(p => p.path), hour, { download: true }),
  ]);
  const viewUrl = new Map((view.data ?? []).filter(s => s.signedUrl).map(s => [s.path, s.signedUrl]));
  const downloadUrl = new Map((download.data ?? []).filter(s => s.signedUrl).map(s => [s.path, s.signedUrl]));
  const photos: SharedPhoto[] = d.photos.flatMap(p => {
    const full = viewUrl.get(p.path);
    if (!full) return [];
    return [{ id: p.id, caption: p.caption, takenAt: p.taken_at, full, thumb: viewUrl.get(p.thumb) ?? full, download: downloadUrl.get(p.path) ?? full }];
  });
  const place = [d.customer.address, d.customer.city].filter(Boolean).join(', ');

  return (
    <>
      <div className="public-bar">
        <span>{d.company.company}{d.company.phone ? ` · ${d.company.phone}` : ''}</span>
      </div>
      <section className="panel">
        <h1>Your project photos</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          {place ? `${place} · ` : ''}{photos.length} photo{photos.length === 1 ? '' : 's'}
        </p>
        {d.message && <p className="share-message">{d.message}</p>}
        {photos.length ? <CustomerGallery photos={photos} /> : <p className="muted" style={{ marginTop: 12 }}>These photos are no longer available.</p>}
        <p className="muted" style={{ marginTop: 16 }}>
          Questions? {d.company.phone ? <>Call <a href={`tel:${d.company.phone.replace(/[^\d+]/g, '')}`}>{d.company.phone}</a></> : null}
          {d.company.phone && d.company.email ? ' or email ' : d.company.email ? 'Email ' : ''}
          {d.company.email ? <a href={`mailto:${d.company.email}`}>{d.company.email}</a> : null}
          {!d.company.phone && !d.company.email ? `Contact ${d.company.company || 'us'}.` : '.'}
        </p>
      </section>
    </>
  );
}
