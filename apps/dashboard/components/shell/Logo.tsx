import { useId } from 'react';
import type { Locale } from '../../i18n/config';

// One geometry with public/brand/*.svg: a story ring open at the top-end with a "new story" dot in the gap,
// around an S built from two stacked arcs. Inline so it follows the theme (ink S on light, paper S on dark).
const RING = 'M39.32 11.14A20 20 0 1 1 27.47 4.3';
const S = 'M28.76 15.75A5.5 5.5 0 1 0 24 24A5.5 5.5 0 1 1 19.24 32.25';
const MARK_STROKE = 4.6;
const MARK_VIEWBOX = 48;

interface MarkProps {
  size?: number;
  /** Accessible name; omit when a visible wordmark sits next to it. */
  title?: string;
  /** Draw the ring in once on mount (login hero). Static under reduced motion. */
  animated?: boolean;
  className?: string;
}

export function LogoMark({ size = 32, title, animated = false, className }: MarkProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={`shrink-0 text-foreground ${className ?? ''}`}
    >
      <defs>
        <linearGradient id={`ring-${id}`} gradientUnits="userSpaceOnUse" x1="6" y1="42" x2="42" y2="6">
          <stop offset="0" style={{ stopColor: 'var(--primary)' }} />
          <stop offset="1" style={{ stopColor: 'var(--accent)' }} />
        </linearGradient>
      </defs>
      <path
        d={RING}
        fill="none"
        stroke={`url(#ring-${id})`}
        strokeWidth="4.5"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray={animated ? 100 : undefined}
        className={animated ? 'animate-ring-draw' : undefined}
      />
      <circle cx="34" cy="6.68" r="2.6" fill="var(--accent)" className={animated ? 'origin-center animate-dot-pop [transform-box:fill-box]' : undefined} />
      <path d={S} fill="none" stroke="currentColor" strokeWidth={MARK_STROKE} strokeLinecap="round" />
    </svg>
  );
}

/**
 * Lockup: mark at the inline-start of the wordmark (right side in RTL, by DOM order).
 * Clear space is 2x the S stroke, scaled to the rendered mark size.
 */
export function Logo({ locale, name, size = 32, animated = false }: { locale: Locale; name: string; size?: number; animated?: boolean }) {
  const clear = Math.round(((size * MARK_STROKE) / MARK_VIEWBOX) * 2 * 100) / 100;
  return (
    <span className="inline-flex items-center gap-2 text-foreground" style={{ padding: clear }}>
      <LogoMark size={size} animated={animated} />
      <span className={locale === 'ar' ? 'text-xl font-bold' : 'text-xl font-extrabold tracking-[-0.03em]'} style={{ fontSize: Math.round(size * 0.62) }}>
        {name}
      </span>
    </span>
  );
}
