import type { ReactNode } from 'react';
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset, SidebarMenu, SidebarProvider, SidebarRail, SidebarTrigger } from '@slips/ui';
import { directionOf } from '../../i18n/config';
import type { Locale } from '../../i18n/config';
import type { Messages } from '../../i18n/messages';
import { SUPPORT_HREF } from '../../lib/shell';
import type { ShellContext } from '../../lib/shell';
import { LocaleSwitch } from './LocaleSwitch';
import { ThemeSwitch } from './ThemeSwitch';
import { ConnectionChip } from './ConnectionChip';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { SessionActions, SignOutMenuItem } from '../session/SessionActions';
import { SessionGate } from '../session/SessionGate';
import { StoreName } from './StoreName';
import { NavList, SettingsNavItem } from './NavList';

interface Props {
  locale: Locale;
  messages: Messages;
  context: ShellContext;
  /** Saved sidebar state (cookie), so the first paint already has the right width. */
  sidebarOpen?: boolean;
  children: ReactNode;
}

export function AppShell({ locale, messages, context, sidebarOpen = true, children }: Props) {
  const m = messages.shell;
  const storeName = context.connection.state === 'connected' ? context.connection.storeName : m.storeFallback;
  return (
    // The sidebar is pinned to the viewport's inline-start edge; only the page content is capped in width.
    <SidebarProvider defaultOpen={sidebarOpen} dir={directionOf(locale)} className="bg-page text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-pill focus:bg-primary focus:px-4 focus:py-2 focus:font-semibold focus:text-primary-foreground"
      >
        {m.skipToContent}
      </a>
      <Sidebar mobileTitle={m.menuTitle} mobileDescription={m.primaryNav} closeLabel={m.closeMenu}>
        <SidebarHeader>
          {/* The mark sits on the nav icons' axis; collapsing clips the wordmark, which also fades. */}
          <div className="flex h-12 items-center overflow-hidden whitespace-nowrap [&>span>span]:transition-opacity [&>span>span]:duration-200 group-data-[collapsible=icon]:[&>span>span]:opacity-0">
            <Logo locale={locale} name={messages.app.name} />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <NavList />
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SettingsNavItem />
            <SignOutMenuItem />
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail label={m.toggleSidebar} />
      </Sidebar>
      <SidebarInset>
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-page px-(--page-padding) py-3">
          <SidebarTrigger aria-label={m.toggleSidebar} title={m.toggleSidebar} className="-ms-2" />
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-small text-muted-foreground">{m.storeIdentity}</span>
            <StoreName initial={storeName} />
          </div>
          <ConnectionChip connection={context.connection} messages={messages} />
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <a
              href={SUPPORT_HREF}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-pill px-3 text-small font-medium text-info-text hover:bg-secondary"
            >
              <Icon name="help" className="size-4" />
              {m.needHelp}
            </a>
            {context.storeUrl ? (
              <a
                href={context.storeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-pill bg-primary px-4 text-small font-semibold text-primary-foreground"
              >
                {m.previewStore}
                <Icon name="external" className="size-4" />
              </a>
            ) : (
              <span className="group relative">
                <button
                  type="button"
                  aria-disabled="true"
                  aria-describedby="preview-reason"
                  className="inline-flex min-h-9 cursor-not-allowed items-center gap-1.5 rounded-pill bg-secondary px-4 text-small font-semibold text-muted-foreground"
                >
                  {m.previewStore}
                </button>
                <span
                  id="preview-reason"
                  role="tooltip"
                  className="sr-only group-focus-within:not-sr-only group-hover:not-sr-only group-focus-within:absolute group-hover:absolute group-focus-within:top-full group-hover:top-full group-focus-within:z-10 group-hover:z-10 group-focus-within:mt-1 group-hover:mt-1 group-focus-within:whitespace-nowrap group-hover:whitespace-nowrap group-focus-within:rounded-md group-hover:rounded-md group-focus-within:bg-foreground group-hover:bg-foreground group-focus-within:px-2 group-hover:px-2 group-focus-within:py-1 group-hover:py-1 group-focus-within:text-small group-hover:text-small group-focus-within:text-background group-hover:text-background"
                >
                  {m.previewUnavailable}
                </span>
              </span>
            )}
            <SessionActions />
            <ThemeSwitch />
            <LocaleSwitch />
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="px-(--page-padding) py-6 outline-none">
          <div className="mx-auto grid w-full max-w-[1200px] grid-cols-12 gap-x-(--spacing-gutter)">
            <div className="col-span-12">
              <SessionGate>{children}</SessionGate>
            </div>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
