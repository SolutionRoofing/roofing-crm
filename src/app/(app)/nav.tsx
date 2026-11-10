'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/icon';

export type NavItem = { href: string; label: string; icon: IconName };

export function NavLinks({ items, variant }: { items: NavItem[]; variant: 'side' | 'tabs' }) {
  const pathname = usePathname();
  return items.map(item => {
    const on = pathname === item.href || pathname.startsWith(`${item.href}/`);
    return (
      <Link key={item.href} href={item.href} className={on ? 'on' : undefined} aria-current={on ? 'page' : undefined}>
        <Icon name={item.icon} size={variant === 'tabs' ? 22 : 18} />
        <span>{item.label}</span>
      </Link>
    );
  });
}
