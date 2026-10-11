import type { Locale } from '../../i18n/config';

const MARK_VIEWBOX = 48;
const MARK_STROKE = 4.6;

/**
 * Lockup: mark at the inline-start of the wordmark (right side in RTL, by DOM order).
 * Clear space is 2x the S stroke, scaled to the rendered mark size.
 */
export function Logo({ locale, name, size = 32 }: { locale: Locale; name: string; size?: number }) {
  const clear = Math.round(((size * MARK_STROKE) / MARK_VIEWBOX) * 2 * 100) / 100;
  return (
    <span className="inline-flex items-center gap-2" style={{ padding: clear }}>
      <img src="/brand/logo-mark.svg" alt="" width={size} height={size} className="dark:hidden" />
      <img src="/brand/logo-mark-dark.svg" alt="" width={size} height={size} className="hidden dark:block" />
      <span className={locale === 'ar' ? 'text-xl font-bold' : 'text-xl font-extrabold tracking-tight'}>{name}</span>
    </span>
  );
}
