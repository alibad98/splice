'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { withLang } from '../../i18n/config';
import { useI18n } from '../../i18n/provider';

/** Switches language by rewriting ?lang on the current URL (no third-party cookie needed). */
export function LocaleSwitch() {
  const { locale, messages } = useI18n();
  const pathname = usePathname();
  const params = useSearchParams();
  const other = locale === 'ar' ? 'en' : 'ar';
  const q = new URLSearchParams(params.toString());
  q.delete('lang');
  const qs = q.toString();
  return (
    <Link
      href={withLang(qs ? `${pathname}?${qs}` : pathname, other)}
      lang={other}
      aria-label={messages.shell.switchToLabel}
      className="inline-flex min-h-9 items-center rounded-pill border border-input-border px-3 text-small font-semibold hover:bg-secondary"
    >
      {messages.shell.switchTo}
    </Link>
  );
}
