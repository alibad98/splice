import { cn } from './cn.js';

export interface SpinnerProps {
  /** Accessible label. Without one the spinner is decorative (the surrounding control announces busy). */
  label?: string;
  className?: string;
}

/**
 * Small inline progress spinner for pending controls (never a page spinner: pages use skeletons). Sized by font size
 * (1em), coloured by `currentColor`. Under `prefers-reduced-motion` it stops spinning (globals.css) and stays as a static
 * arc, so the busy state is still visible.
 */
export function Spinner({ label, className }: SpinnerProps) {
  const svg = (
    <svg
      data-slot="spinner"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn('size-[1em] shrink-0 animate-spin motion-reduce:animate-none', className)}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
  if (!label) return svg;
  return (
    <span role="status" className="inline-flex items-center">
      {svg}
      <span className="sr-only">{label}</span>
    </span>
  );
}
