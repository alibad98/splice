import type { ReactNode } from 'react';
import { Badge } from './badge.js';

/** Role words from DESIGN.md: neutral = draft/ended/archived, info = scheduled/processing, success, warning, danger. */
export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface StatusChipProps {
  tone: StatusTone;
  /** The visible label. Required: status is never shown by colour alone. */
  children: ReactNode;
  /** `soft` (default): tinted pill. `outline`: border only, for quiet end states (ended, archived). */
  variant?: 'soft' | 'outline';
  /** Leading icon (e.g. archive). Replaces the dot. */
  icon?: ReactNode;
  /** Leading 6px dot (default on; ignored when `icon` is set). */
  dot?: boolean;
  /** Live states (processing, syncing): the dot pulses; it is static under `prefers-reduced-motion`. */
  pulse?: boolean;
  className?: string;
}

/** Status of a record (product, story, sync): a small Badge with a leading dot or icon. */
export function StatusChip({ tone, children, variant = 'soft', icon, dot = true, pulse = false, className }: StatusChipProps) {
  return (
    <Badge data-slot="status-chip" tone={tone} variant={variant} size="sm" dot={icon ? false : dot} pulse={pulse} className={className}>
      {icon ? (
        <span aria-hidden="true" className="inline-flex shrink-0 [&>svg]:size-3">
          {icon}
        </span>
      ) : null}
      {children}
    </Badge>
  );
}
