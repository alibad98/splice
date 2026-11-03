'use client';

import { usePathname } from 'next/navigation';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@slips/ui';
import { LangLink } from './LangLink';
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

function NavItem({ item, pathname }: { item: Item; pathname: string }) {
  const { messages } = useI18n();
  const active = isActive(pathname, item.href);
  const label = messages.shell.nav[item.key];
  return (
    <SidebarMenuItem>
      {/* The label stays in the DOM when the rail collapses (clipped), so the link keeps its name; the tooltip is for sight. */}
      <SidebarMenuButton asChild isActive={active} tooltip={label}>
        <LangLink href={item.href} aria-current={active ? 'page' : undefined}>
          <Icon name={item.icon} />
          <span>{label}</span>
        </LangLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** Primary sections, at the top of the sidebar. */
export function NavList() {
  const pathname = usePathname();
  const { messages } = useI18n();
  return (
    <nav aria-label={messages.shell.primaryNav}>
      <SidebarMenu>
        {primaryNav.map((item) => (
          <NavItem key={item.key} item={item} pathname={pathname} />
        ))}
      </SidebarMenu>
    </nav>
  );
}

/** Settings, pinned to the sidebar footer above Sign out. */
export function SettingsNavItem() {
  const pathname = usePathname();
  return <NavItem item={settingsNav} pathname={pathname} />;
}
