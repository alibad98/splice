'use client';

import { LangLink } from './LangLink';
import { usePathname } from 'next/navigation';
import { useI18n } from '../../i18n/provider';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export const primaryNav = [
  { key: 'overview', href: '/', icon: 'overview' },
  { key: 'content', href: '/content', icon: 'content' },
  { key: 'products', href: '/products', icon: 'products' },
  { key: 'analytics', href: '/analytics', icon: 'analytics' },
] as const satisfies readonly { key: string; href: string; icon: IconName }[];
export const settingsNav = { key: 'settings', href: '/settings', icon: 'settings' } as const;

export function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

type Item = (typeof primaryNav)[number] | typeof settingsNav;

function NavLink({ item, pathname, labelClass, collapsed, onNavigate }: { item: Item; pathname: string; labelClass: string; collapsed: boolean; onNavigate?: () => void }) {
  const { messages } = useI18n();
  const active = isActive(pathname, item.href);
  const label = messages.shell.nav[item.key];
  return (
    <LangLink
      href={item.href}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? label : undefined}
      onClick={onNavigate}
      className={`flex items-center gap-3 rounded-pill px-3 py-2.5 text-body font-semibold ${
        active ? 'bg-primary text-primary-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent'
      }`}
    >
      <Icon name={item.icon} />
      <span className={labelClass}>{label}</span>
    </LangLink>
  );
}

/** Start-side nav. `collapsed` hides labels below lg (icons only at md). */
export function NavList({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { messages } = useI18n();
  const labelClass = collapsed ? 'sr-only lg:not-sr-only' : '';
  return (
    <nav aria-label={messages.shell.primaryNav} className="flex flex-1 flex-col justify-between gap-6">
      <ul className="flex flex-col gap-1">
        {primaryNav.map((item) => (
          <li key={item.key}>
            <NavLink item={item} pathname={pathname} labelClass={labelClass} collapsed={collapsed} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
      <ul>
        <li>
          <NavLink item={settingsNav} pathname={pathname} labelClass={labelClass} collapsed={collapsed} onNavigate={onNavigate} />
        </li>
      </ul>
    </nav>
  );
}
