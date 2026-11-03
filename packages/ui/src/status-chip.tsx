import type { ReactNode } from 'react';
import { Badge } from './badge.js';

/** Role words from DESIGN.md: neutral = draft/ended/archived, info = scheduled/processing, success, warning, danger. */
export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface StatusChipProps {
  tone: StatusTone;
  /** The visible label. Required: status is never shown by colour alone. */
  children: ReactNode;
  /** Leading 6px dot (default on). */
  dot?: boolean;
  /** Live states (processing, syncing): the dot pulses. */
  pulse?: boolean;
  className?: string;
}

/** Status of a record (product, story, sync): a small soft Badge with a leading dot. */
export function StatusChip({ tone, children, dot = true, pulse = false, className }: StatusChipProps) {
  return (
    <Badge data-slot="status-chip" tone={tone} size="sm" dot={dot} pulse={pulse} className={className}>
      {children}
    </Badge>
  );
}
