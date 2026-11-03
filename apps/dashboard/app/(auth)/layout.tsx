import type { ReactNode } from 'react';
import { Badge } from '@slips/ui';
import { BrandShowcase } from '../../components/auth/BrandShowcase';
import { DotField } from '../../components/auth/DotField';
import { Logo } from '../../components/shell/Logo';
import { LocaleSwitch } from '../../components/shell/LocaleSwitch';
import { ThemeSwitch } from '../../components/shell/ThemeSwitch';
import { getMessages } from '../../i18n/messages';
import { getLocale } from '../../i18n/server';

/**
 * Auth frame. Exactly one screen when the form fits (no stray margins, so no scrollbar); if the window is very short
 * the page itself scrolls (never an inner scroller: the app runs in Salla's iframe) and the brand panel stays put. Mobile: a single column at least one screen tall, centred. The brand panel is always dark: it scopes
 * the `.dark` tokens to itself instead of hard-coding colours.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const m = getMessages(locale);
  const a = m.auth;

  return (
    <div className="flex min-h-dvh flex-col bg-page text-foreground selection:bg-primary selection:text-primary-foreground lg:grid lg:grid-cols-2">
      <aside className="dark sticky top-0 hidden h-dvh flex-col items-center overflow-hidden border-e border-border bg-background px-12 py-[clamp(16px,3.5dvh,32px)] text-center text-foreground select-none lg:flex xl:px-20">
        <DotField />

        <div className="relative z-10">
          <Logo locale={locale} name={m.app.name} size={34} animated />
        </div>

        <div className="relative z-10 my-auto flex min-h-0 w-full max-w-2xl flex-col items-center gap-[clamp(10px,2.2dvh,20px)] py-[clamp(12px,3dvh,32px)]">
          <Badge tone="accent" variant="outline" size="lg" icon="check" glass>
            {a.verifiedForSalla}
          </Badge>
          <h1 className="text-[clamp(1.6rem,min(2.8vw,5.2dvh),3rem)] leading-[1.12] font-extrabold tracking-[-0.025em] text-balance [:lang(ar)_&]:leading-[1.4] [:lang(ar)_&]:font-bold">{a.heroTitle}</h1>
          <p className="-mt-1 max-w-xl text-body-lg text-pretty text-muted-foreground">{a.brandDescription}</p>
          <div className="mt-[clamp(4px,1.5dvh,16px)] flex w-full justify-center">
            <BrandShowcase a={a} />
          </div>
        </div>

        <div className="relative z-10 flex items-center gap-3 text-small text-muted-foreground">
          <span>
            © {new Date().getFullYear()} {m.app.name}
          </span>
          <span aria-hidden="true">·</span>
          <span>{a.privacy}</span>
          <span aria-hidden="true">·</span>
          <span>{a.terms}</span>
        </div>
      </aside>

      <main className="flex min-h-dvh flex-1 flex-col px-5 py-4 sm:px-10 lg:px-16 lg:py-[clamp(12px,2.5dvh,24px)] xl:px-24">
        <header className="flex items-center justify-between gap-3">
          <div className="lg:hidden">
            <Logo locale={locale} name={m.app.name} size={28} />
          </div>
          <div className="ms-auto flex items-center gap-2">
            <ThemeSwitch />
            <LocaleSwitch />
          </div>
        </header>

        <div className="flex flex-1 items-center justify-center py-[clamp(8px,2.5dvh,24px)]">
          <div className="w-full max-w-[480px] animate-rise-in rounded-xl border border-border bg-card p-6 shadow-card sm:p-[clamp(20px,3.6dvh,32px)]">{children}</div>
        </div>

        <footer className="text-center text-small text-pretty text-muted-foreground [@media(max-height:680px)]:sr-only">
          <p>{a.footerSecurity}</p>
        </footer>
      </main>
    </div>
  );
}
