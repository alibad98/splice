import type { ReactNode } from 'react';
import { Logo } from '../../components/shell/Logo';
import { LocaleSwitch } from '../../components/shell/LocaleSwitch';
import { getMessages } from '../../i18n/messages';
import { getLocale } from '../../i18n/server';

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const m = getMessages(locale);
  const a = m.auth;

  return (
    <div className="min-h-screen bg-[var(--page)] flex flex-col lg:grid lg:grid-cols-12 text-foreground selection:bg-[var(--primary)] selection:text-white">
      {/* Brand Hero Panel (Desktop) */}
      <aside className="hidden lg:col-span-5 xl:col-span-6 lg:flex flex-col justify-between relative overflow-hidden bg-[#100D0C] p-12 text-[#F5F1EE] border-e border-white/10">
        {/* Ambient Gradient Glows */}
        <div className="absolute top-0 end-0 -mt-24 -me-24 w-96 h-96 rounded-full bg-[radial-gradient(circle,rgba(255,74,61,0.25)_0%,transparent_70%)] blur-2xl pointer-events-none" />
        <div className="absolute bottom-10 start-0 -ms-20 w-80 h-80 rounded-full bg-[radial-gradient(circle,rgba(255,194,61,0.18)_0%,transparent_70%)] blur-2xl pointer-events-none" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,rgba(0,0,0,0.4)_100%)] pointer-events-none" />

        {/* Brand Top Header */}
        <div className="relative z-10 flex items-center justify-between">
          <Logo locale={locale} name={m.app.name} size={36} />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-[#FFC23D] backdrop-blur-sm">
            <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            {a.verifiedForSalla}
          </span>
        </div>

        {/* Hero Copy & Visual Showcase */}
        <div className="relative z-10 my-auto py-12 max-w-lg">
          <h1 className="text-3xl xl:text-4xl font-extrabold tracking-tight leading-tight text-white mb-4">
            {a.heroTitle}
          </h1>
          <p className="text-base xl:text-lg text-[#A89F99] leading-relaxed mb-8">
            {a.brandDescription}
          </p>

          {/* Interactive Feature Card Mockup */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl backdrop-blur-md">
            <div className="flex items-center gap-3 mb-4">
              <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full p-[2px] [background:conic-gradient(#FF4A3D,#FFC23D,#FF4A3D)]">
                <div className="h-full w-full rounded-full bg-[#100D0C] flex items-center justify-center font-bold text-xs text-white">
                  ▶
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-white truncate">
                    {a.reelTitle}
                  </p>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#3FD27F] bg-[#3FD27F]/10 px-2 py-0.5 rounded-full">
                    +34% {a.cvrBoost}
                  </span>
                </div>
                <p className="text-xs text-[#A89F99] truncate">
                  {a.reelProduct}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5 pt-3 border-t border-white/10 text-center">
              <div className="rounded-xl bg-white/[0.03] p-2.5 border border-white/5">
                <p className="text-lg font-bold text-white">{a.statEngagementVal}</p>
                <p className="text-[11px] text-[#A89F99]">{a.statEngagement}</p>
              </div>
              <div className="rounded-xl bg-white/[0.03] p-2.5 border border-white/5">
                <p className="text-lg font-bold text-[#FFC23D]">{a.statAovVal}</p>
                <p className="text-[11px] text-[#A89F99]">{a.statAov}</p>
              </div>
              <div className="rounded-xl bg-white/[0.03] p-2.5 border border-white/5">
                <p className="text-lg font-bold text-white">{a.statZeroCodeVal}</p>
                <p className="text-[11px] text-[#A89F99]">{a.statZeroCode}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10 flex items-center justify-between text-xs text-[#7A716C]">
          <span>© {new Date().getFullYear()} {m.app.name}</span>
          <div className="flex items-center gap-4">
            <span className="hover:text-[#A89F99] cursor-pointer">{a.privacy}</span>
            <span className="hover:text-[#A89F99] cursor-pointer">{a.terms}</span>
          </div>
        </div>
      </aside>

      {/* Auth Form Container Panel */}
      <main className="col-span-12 lg:col-span-7 xl:col-span-6 flex flex-col justify-between min-h-screen p-6 sm:p-10 lg:p-14">
        {/* Top bar with mobile logo & language switch */}
        <header className="flex items-center justify-between w-full mb-6">
          <div className="lg:hidden">
            <Logo locale={locale} name={m.app.name} size={30} />
          </div>
          <div className="ms-auto">
            <LocaleSwitch />
          </div>
        </header>

        {/* Center Card Content */}
        <div className="w-full max-w-md mx-auto my-auto py-4">
          <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-[var(--card-shadow)]">
            {children}
          </div>
        </div>

        {/* Bottom spacer / footer note */}
        <footer className="text-center text-xs text-muted-foreground mt-8">
          <p>{a.footerSecurity}</p>
        </footer>
      </main>
    </div>
  );
}
