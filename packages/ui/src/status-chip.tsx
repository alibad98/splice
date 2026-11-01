import type { ReactNode } from 'react';
import { cn } from './cn.js';

/** Role words from DESIGN.md: neutral = draft/ended/archived, info = scheduled/processing, success, warning, danger. */
export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<StatusTone, { chip: string; dot: string }> = {
  neutral: { chip: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' },
  info: { chip: 'bg-primary-tint text-info-text', dot: 'bg-primary' },
  success: { chip: 'bg-success-tint text-success-text', dot: 'bg-success' },
  warning: { chip: 'bg-warning-tint text-warning-text', dot: 'bg-warning' },
  danger: { chip: 'bg-destructive-tint text-destructive-text', dot: 'bg-destructive' },
};

export interface StatusChipProps {
  tone: StatusTone;
  /** The visible label. Required: status is never shown by colour alone. */
  children: ReactNode;
  /** Leading 6px dot (default on). */
  dot?: boolean;
  className?: string;
}

/** Pill status badge: 11.5px 600 (12px minimum in Arabic), tinted background, `-text` colour and a leading dot. */
export function StatusChip({ tone, children, dot = true, className }: StatusChipProps) {
  const t = TONES[tone];
  return (
    <span data-slot="status-chip" data-tone={tone} className={cn('inline-flex items-center gap-1.5 rounded-pill px-2 py-[3px] text-[11.5px] leading-none font-semibold whitespace-nowrap [:lang(ar)_&]:text-xs', t.chip, className)}>
      {dot ? <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', t.dot)} /> : null}
      {children}
    </span>
  );
}
