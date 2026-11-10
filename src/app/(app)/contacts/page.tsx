import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Icon } from '@/components/icon';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { fullAddress, fullName, telHref } from '@/lib/format';

export const metadata: Metadata = { title: 'Customers' };

export default function ContactsPage({ searchParams }: PageProps<'/contacts'>) {
  return (
    <>
      <div className="page-head">
        <h1>Customers</h1>
        <Link className="btn primary" href="/contacts/new"><Icon name="plus" size={16} /> Add customer</Link>
      </div>
      <Suspense fallback={<div className="panel muted">Loading…</div>}>
        <List searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function List({ searchParams }: { searchParams: PageProps<'/contacts'>['searchParams'] }) {
  await requireUser(['owner', 'office', 'rep']);
  const raw = (await searchParams).q;
  const q = typeof raw === 'string' ? raw.trim() : '';
  const supabase = await createClient();
  let query = supabase.from('contacts')
    .select('id, first, last, phone, email, address, city, st, zip, source, marketing, jobs(id)')
    .order('last').order('first').limit(500);
  if (q) {
    const like = `"%${q.replace(/[%,()*"\\]/g, ' ').trim()}%"`;
    query = query.or(`first.ilike.${like},last.ilike.${like},phone.ilike.${like},email.ilike.${like},address.ilike.${like},city.ilike.${like}`);
  }
  const { data, error } = await query;

  return (
    <>
      <form className="filters" style={{ marginBottom: 12 }}>
        <input type="search" name="q" defaultValue={q} placeholder="Search name, phone, email or address" aria-label="Search customers" style={{ minWidth: 260 }} />
        <button className="btn">Search</button>
        {q && <Link className="btn danger-ghost" href="/contacts">Clear</Link>}
      </form>
      {error && <div className="panel form-error">Could not load customers: {error.message}</div>}
      {!error && !data?.length && <div className="panel empty"><strong>{q ? 'No customers match' : 'No customers yet'}</strong><p>Customers are added with each new lead.</p></div>}
      {!!data?.length && (
        <div className="panel flush table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Phone</th><th className="hide-sm">Address</th><th className="hide-sm">Source</th><th>Jobs</th></tr></thead>
            <tbody>
              {data.map(c => (
                <tr key={c.id}>
                  <td><Link href={`/contacts/${c.id}`}><b>{fullName(c)}</b></Link><small>{c.email}</small></td>
                  <td>{c.phone ? <a href={telHref(c.phone)}>{c.phone}</a> : <span className="muted">None</span>}</td>
                  <td className="hide-sm">{fullAddress(c)}</td>
                  <td className="hide-sm">{c.source}{c.marketing && <> <span className="pill">Marketing OK</span></>}</td>
                  <td className="num">{(c.jobs as unknown[] | null)?.length ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
