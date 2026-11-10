import { Suspense } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icon';
import { getCurrentUser, isAdmin, ROLE_LABELS, type CurrentUser } from '@/lib/auth';
import { signOut } from '@/app/login/actions';
import { NavLinks, type NavItem } from './nav';

function navFor(user: CurrentUser | null): NavItem[] {
  if (!user?.active) return [];
  if (user.role === 'crew') return [{ href: '/work-orders', label: 'My work', icon: 'clipboard' }];
  const items: NavItem[] = [
    { href: '/dashboard', label: 'Dashboard', icon: 'home' },
    { href: '/work-orders', label: 'Work orders', icon: 'clipboard' },
  ];
  if (isAdmin(user)) items.push({ href: '/team', label: 'Team', icon: 'users' });
  return items;
}

async function SideNav() {
  return <NavLinks items={navFor(await getCurrentUser())} variant="side" />;
}

async function TabBar() {
  return <NavLinks items={navFor(await getCurrentUser())} variant="tabs" />;
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

// Session reads sit behind Suspense so the shell itself renders instantly.
export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="app">
      <aside className="side">
        <Link className="brand" href="/"><span className="brand-mark"><Icon name="roof" /></span>Roofing CRM</Link>
        <nav id="sideNav" aria-label="Main"><Suspense fallback={null}><SideNav /></Suspense></nav>
        <Suspense fallback={null}><UserBox /></Suspense>
      </aside>
      <div className="main-wrap">
        <div className="mobile-top">
          <span>Roofing CRM</span>
          <form action={signOut}><button>Sign out</button></form>
        </div>
        <main id="view">{children}</main>
      </div>
      <nav className="tabbar" aria-label="Main"><Suspense fallback={null}><TabBar /></Suspense></nav>
    </div>
  );
}
