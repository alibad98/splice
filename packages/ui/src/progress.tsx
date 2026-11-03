// Progress: linear determinate and indeterminate progress bar (uploads, sync, processing).
// Fills from the inline start in both LTR and RTL; static under prefers-reduced-motion.
import type { ComponentProps } from 'react';
import { cn } from './cn.js';

export type ProgressTone = 'primary' | 'success' | 'warning' | 'danger';

const TONE_FILL: Record<ProgressTone, string> = {
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
};

export interface ProgressProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Current value (`0..max`). Omit or pass `null` for an indeterminate bar. */
  value?: number | null;
  /** Maximum value (defaults to 100). */
  max?: number;
  /** Accessible name of the progress bar. */
  label?: string;
  /** Human-readable value text for screen readers (e.g. "40%"). */
  valueText?: string;
  tone?: ProgressTone;
}

/**
 * Linear progress bar (`role="progressbar"`). Values outside `0..max` are clamped.
 * Indeterminate bars animate along the inline axis and become a static bar under `prefers-reduced-motion`.
 */
export function Progress({ value, max = 100, label, valueText, tone = 'primary', className, ...props }: ProgressProps) {
  const safeMax = max > 0 ? max : 100;
  const determinate = typeof value === 'number' && !Number.isNaN(value);
  const clamped = determinate ? Math.min(safeMax, Math.max(0, value)) : undefined;
  const percent = clamped !== undefined ? Math.round((clamped / safeMax) * 100) : undefined;

  return (
    <div
      data-slot="progress"
      data-state={determinate ? 'determinate' : 'indeterminate'}
      data-tone={tone}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={clamped}
      aria-valuetext={valueText ?? (percent !== undefined ? `${percent}%` : undefined)}
      className={cn('relative h-2 w-full overflow-hidden rounded-pill bg-muted', !determinate && 'rtl:-scale-x-100', className)}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        style={percent !== undefined ? { width: `${percent}%` } : undefined}
        className={cn(
          'h-full rounded-pill transition-[width] duration-200 ease-out motion-reduce:transition-none',
          TONE_FILL[tone],
          !determinate && 'w-2/5 animate-progress-indeterminate motion-reduce:animate-none',
        )}
      />
    </div>
  );
}

