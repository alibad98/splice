import type { ReactNode } from 'react';
import { setLocale } from '../../i18n/actions';
import type { Locale } from '../../i18n/config';
import type { Messages } from '../../i18n/messages';
import { SUPPORT_HREF } from '../../lib/shell';
import type { ShellContext } from '../../lib/shell';
import { ConnectionChip } from './ConnectionChip';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { MobileNav } from './MobileNav';
import { NavList } from './NavList';

interface Props {
  locale: Locale;
  messages: Messages;
  context: ShellContext;
  children: ReactNode;
}

export function AppShell({ locale, messages, context, children }: Props) {
  const m = messages.shell;
  const other: Locale = locale === 'ar' ? 'en' : 'ar';
  const storeName = context.connection.state === 'connected' ? context.connection.storeName : m.storeFallback;
  return (
    <div className="min-h-dvh bg-page text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-pill focus:bg-primary focus:px-4 focus:py-2 focus:font-semibold focus:text-primary-foreground"
      >
        {m.skipToContent}
      </a>
      <div className="mx-auto flex max-w-[1360px]">
        <aside className="sticky top-0 hidden h-dvh w-16 shrink-0 flex-col gap-4 border-e border-sidebar-border bg-sidebar p-2 md:flex lg:w-60 lg:p-4">
          <div className="hidden lg:block">
            <Logo locale={locale} name={messages.app.name} />
          </div>
          <div className="lg:hidden">
            <img src="/brand/logo-mark.svg" alt={messages.app.logoAlt} width={32} height={32} className="mx-auto dark:hidden" />
            <img src="/brand/logo-mark-dark.svg" alt={messages.app.logoAlt} width={32} height={32} className="mx-auto hidden dark:block" />
          </div>
          <NavList collapsed />
        </aside>
        <div className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-page px-(--page-padding) py-3">
            <MobileNav />
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-small text-muted-foreground">{m.storeIdentity}</span>
              <span className="truncate text-body font-bold">{storeName}</span>
            </div>
            <ConnectionChip connection={context.connection} messages={messages} />
            <div className="ms-auto flex flex-wrap items-center gap-2">
              <a
                href={SUPPORT_HREF}
                target="_blank"
                rel="noopener noreferrer"
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
                <button
                  type="button"
                  aria-disabled="true"
                  title={m.previewUnavailable}
                  className="inline-flex min-h-9 cursor-not-allowed items-center gap-1.5 rounded-pill bg-secondary px-4 text-small font-semibold text-muted-foreground"
                >
                  {m.previewStore}
                </button>
              )}
              <form action={setLocale}>
                <input type="hidden" name="locale" value={other} />
                <button
                  type="submit"
                  lang={other}
                  aria-label={m.switchToLabel}
                  className="inline-flex min-h-9 items-center rounded-pill border border-input-border px-3 text-small font-semibold hover:bg-secondary"
                >
                  {m.switchTo}
                </button>
              </form>
            </div>
          </header>
          <main id="main-content" tabIndex={-1} className="grid grid-cols-12 gap-x-(--spacing-gutter) px-(--page-padding) py-6 outline-none">
            <div className="col-span-12">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
