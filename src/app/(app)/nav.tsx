'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/icon';

export type NavItem = { href: string; label: string; icon: IconName };

const matches = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** moreFor: pages reached through the "More" tab, so it lights up on them. */
export function NavLinks({ items, variant, moreFor = [] }: { items: NavItem[]; variant: 'side' | 'tabs'; moreFor?: string[] }) {
  const pathname = usePathname();
  return items.map(item => {
    const on = matches(pathname, item.href) || (item.href === '/more' && moreFor.some(h => matches(pathname, h)));
    return (
      <Link key={item.href} href={item.href} className={on ? 'on' : undefined} aria-current={on ? 'page' : undefined}>
        <Icon name={item.icon} size={variant === 'tabs' ? 22 : 18} />
        <span>{item.label}</span>
      </Link>
    );
  });
}
