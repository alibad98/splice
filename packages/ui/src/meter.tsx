// Meter: plan usage bar (DESIGN.md "Plan usage meter").
// 6px pill bar; fill foreground <80%, warning >=80%, destructive >=100%, always with "n of m" text.
import type { ComponentProps } from 'react';
import { cn } from './cn.js';

export type MeterTone = 'default' | 'warning' | 'danger';

export interface MeterProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Used units. */
  value: number;
  /** Plan maximum (`0` shows an empty bar). */
  max: number;
  /** Accessible label (also rendered above the bar when `showHeader` is true). */
  label: string;
  /** Localized "n of m" text (e.g. "8 of 10" / "8 من 10"). Always shown so meaning never relies on colour alone. */
  valueLabel: string;
  /** Hide the visible label text while keeping the `"n of m"` counter and `aria-label`. */
  hideLabel?: boolean;
}

const FILL_BY_TONE: Record<MeterTone, string> = {
  default: 'bg-foreground',
  warning: 'bg-warning',
  danger: 'bg-destructive',
};

const TEXT_BY_TONE: Record<MeterTone, string> = {
  default: 'text-muted-foreground',
  warning: 'text-warning-text font-semibold',
  danger: 'text-destructive-text font-semibold',
};

/** Plan usage meter: 6px (`h-1.5`) pill bar with threshold fills at 80% and 100%. */
export function Meter({ value, max, label, valueLabel, hideLabel = false, className, ...props }: MeterProps) {
  const safeMax = max > 0 ? max : 0;
  const clamped = safeMax > 0 ? Math.min(safeMax, Math.max(0, value)) : 0;
  const ratio = safeMax > 0 ? clamped / safeMax : 0;
  const percent = Math.round(ratio * 100);
  const tone: MeterTone = safeMax <= 0 ? 'default' : ratio >= 1 ? 'danger' : ratio >= 0.8 ? 'warning' : 'default';

  return (
    <div
      data-slot="meter"
      data-tone={tone}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={clamped}
      aria-valuetext={valueLabel}
      className={cn('flex w-full flex-col gap-1.5', className)}
      {...props}
    >
      <div className="flex items-baseline justify-between gap-2 text-small">
        {!hideLabel ? <span className="font-medium text-foreground">{label}</span> : <span className="sr-only">{label}</span>}
        <bdi data-slot="meter-value" className={cn('tabular-nums', TEXT_BY_TONE[tone])}>
          {valueLabel}
        </bdi>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-pill bg-muted">
        <div
          data-slot="meter-indicator"
          style={{ width: `${percent}%` }}
          className={cn('h-full rounded-pill transition-[width,background-color] duration-200 ease-out motion-reduce:transition-none', FILL_BY_TONE[tone])}
        />
      </div>
    </div>
  );
}

