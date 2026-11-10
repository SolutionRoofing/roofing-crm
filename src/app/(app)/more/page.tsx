import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Icon } from '@/components/icon';
import { requireUser } from '@/lib/auth';
import { navFor } from '../nav-items';

export const metadata: Metadata = { title: 'More' };

// Phone menu: everything that doesn't fit in the bottom tab bar.
export default function MorePage() {
  return (
    <>
      <div className="page-head"><h1>More</h1></div>
      <Suspense fallback={null}><Links /></Suspense>
    </>
  );
}

async function Links() {
  const user = await requireUser();
  return (
    <div className="panel">
      {navFor(user).map(i => (
        <Link key={i.href} href={i.href} className="line-item">
          <Icon name={i.icon} /><span className="grow"><b>{i.label}</b></span>
        </Link>
      ))}
    </div>
  );
}
