import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Figtree, Tajawal } from 'next/font/google';
import '@slips/ui/globals.css';
import { THEME_INIT_SCRIPT } from '@slips/ui';
import { directionOf } from '../i18n/config';
import { getMessages } from '../i18n/messages';
import { I18nProvider } from '../i18n/provider';
import { getLocale } from '../i18n/server';

// Latin: Figtree (soft geometric, tabular digits). Arabic: Tajawal, Arabic glyphs only, so Latin and the Western digits
// inside Arabic text (emails, SAR, prices, KPIs) fall through to Figtree: tabular and identical in both languages.
const figtree = Figtree({ subsets: ['latin'], variable: '--font-latin', display: 'swap' });
const tajawalArabic = Tajawal({ subsets: ['arabic'], weight: ['400', '500', '700', '800'], variable: '--font-arabic-face', display: 'swap' });

export async function generateMetadata(): Promise<Metadata> {
  const messages = getMessages(await getLocale());
  return { title: messages.app.name };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} dir={directionOf(locale)} className={`${figtree.variable} ${tajawalArabic.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies a saved light/dark choice before first paint; without one the OS preference wins in CSS. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="tabular-nums">
        <I18nProvider locale={locale} messages={getMessages(locale)}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
