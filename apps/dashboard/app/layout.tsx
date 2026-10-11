import type { ReactNode } from 'react';
import { IBM_Plex_Sans_Arabic, Plus_Jakarta_Sans } from 'next/font/google';
import '@slips/ui/globals.css';

export const metadata = { title: 'Slips' };

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap' });
const plexArabic = IBM_Plex_Sans_Arabic({ subsets: ['arabic'], weight: ['400', '500', '600', '700'], variable: '--font-plex-arabic', display: 'swap' });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${plexArabic.variable}`}>
      <body>{children}</body>
    </html>
  );
}
