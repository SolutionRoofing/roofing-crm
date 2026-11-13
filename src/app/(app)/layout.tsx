import { Suspense } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/logo';
import { LiveRefresh } from '@/components/client';
import { getCurrentUser, ROLE_LABELS } from '@/lib/auth';
import { signOut } from '@/app/login/actions';
import { NavLinks } from './nav';
import { navFor, STAFF_TABS } from './nav-items';

async function SideNav() {
  return <NavLinks items={navFor(await getCurrentUser())} variant="side" />;
}

async function TabBar() {
  const user = await getCurrentUser();
  const items = navFor(user);
  if (user?.role === 'crew') return <NavLinks items={items} variant="tabs" />;
  const tabs = items.filter(i => STAFF_TABS.includes(i.href));
  const rest = items.filter(i => !STAFF_TABS.includes(i.href)).map(i => i.href);
  return <NavLinks items={[...tabs, { href: '/more', label: 'More', icon: 'more' }]} variant="tabs" moreFor={rest} />;
}

async function UserBox() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <div className="user-box">
      <b>{user.fullName || user.email}</b>
      {ROLE_LABELS[user.role]}
      <form action={signOut}><button>Sign out</button></form>
    </div>
  );
}

async function Live() {
  const user = await getCurrentUser();
  return user?.active ? <LiveRefresh /> : null;
}

// Session reads sit behind Suspense so the shell itself renders instantly.
export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="app">
      <aside className="side">
        <Link className="brand-band" href="/" aria-label="Solution Roofing home"><Logo height={104} /></Link>
        <nav id="sideNav" aria-label="Main"><Suspense fallback={null}><SideNav /></Suspense></nav>
        <Suspense fallback={null}><UserBox /></Suspense>
      </aside>
      <div className="main-wrap">
        <div className="mobile-top">
          <Link href="/" aria-label="Solution Roofing home"><Logo height={60} /></Link>
          <form action={signOut}><button>Sign out</button></form>
        </div>
        <main id="view">{children}</main>
      </div>
      <nav className="tabbar" aria-label="Main"><Suspense fallback={null}><TabBar /></Suspense></nav>
      <Suspense fallback={null}><Live /></Suspense>
    </div>
  );
}
