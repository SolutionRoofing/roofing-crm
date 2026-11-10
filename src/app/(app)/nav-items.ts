import { isAdmin, type CurrentUser } from '@/lib/auth';
import type { NavItem } from './nav';

export function navFor(user: CurrentUser | null): NavItem[] {
  if (!user?.active) return [];
  if (user.role === 'crew') {
    return [
      { href: '/work-orders', label: 'My work', icon: 'clipboard' },
      { href: '/settings', label: 'Account', icon: 'gear' },
    ];
  }
  const items: NavItem[] = [
    { href: '/dashboard', label: 'Dashboard', icon: 'home' },
    { href: '/pipeline', label: 'Pipeline', icon: 'board' },
    { href: '/jobs', label: 'Jobs', icon: 'briefcase' },
    { href: '/contacts', label: 'Customers', icon: 'user' },
    { href: '/calendar', label: 'Calendar', icon: 'calendar' },
    { href: '/tasks', label: 'Tasks', icon: 'check' },
    { href: '/money', label: 'Money', icon: 'dollar' },
    { href: '/work-orders', label: 'Work orders', icon: 'clipboard' },
  ];
  if (isAdmin(user)) items.push({ href: '/team', label: 'Team', icon: 'users' });
  items.push({ href: '/settings', label: 'Settings', icon: 'gear' });
  return items;
}

/** Pages that get their own spot in the phone tab bar; the rest live under "More". */
export const STAFF_TABS = ['/pipeline', '/jobs', '/calendar', '/tasks'];
