// Badge: shadcn/ui badge (MIT, https://github.com/shadcn-ui/ui) restyled to DESIGN.md. One pill for every short label:
// statuses, counts, trust marks ("Verified for Salla"), plan names, "New", deltas. Always bordered so it holds its shape
// on tinted surfaces and in forced-colors mode. Meaning never rides on colour alone: pass text (and an icon or dot).
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn.js';
import { Icon, type IconName } from './icon.js';

export type BadgeTone = 'neutral' | 'brand' | 'accent' | 'info' | 'success' | 'warning' | 'danger';
/** `soft`: tint + tone border (default). `solid`: filled, for one loud mark per view. `outline`: border only, quiet. */
export type BadgeVariant = 'soft' | 'solid' | 'outline';
export type BadgeSize = 'sm' | 'md' | 'lg';

const SOFT: Record<BadgeTone, string> = {
  neutral: 'border-border bg-muted text-muted-foreground',
  brand: 'border-primary/30 bg-primary-tint text-info-text',
  accent: 'border-accent/45 bg-accent/15 text-warning-text',
  info: 'border-primary/25 bg-primary-tint text-info-text',
  success: 'border-success/35 bg-success-tint text-success-text',
  warning: 'border-warning/50 bg-warning-tint text-warning-text',
  danger: 'border-destructive/30 bg-destructive-tint text-destructive-text',
};

// Fills keep DESIGN.md's text rule: ink on coral and amber, never white on coral.
const SOLID: Record<BadgeTone, string> = {
  neutral: 'border-foreground bg-foreground text-background',
  brand: 'border-primary bg-primary text-primary-foreground',
  accent: 'border-accent bg-accent text-accent-foreground',
  info: 'border-primary bg-primary text-primary-foreground',
  success: 'border-success bg-success text-success-foreground',
  warning: 'border-warning bg-warning text-warning-foreground',
  danger: 'border-destructive bg-destructive text-destructive-foreground',
};

const OUTLINE: Record<BadgeTone, string> = {
  neutral: 'border-input-border text-foreground',
  brand: 'border-primary/60 text-info-text',
  accent: 'border-accent text-warning-text',
  info: 'border-primary/50 text-info-text',
  success: 'border-success/70 text-success-text',
  warning: 'border-warning text-warning-text',
  danger: 'border-destructive/70 text-destructive-text',
};

const DOT: Record<BadgeTone, string> = {
  neutral: 'bg-muted-foreground',
  brand: 'bg-primary',
  accent: 'bg-accent',
  info: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
};

const SIZES: Record<BadgeSize, { box: string; icon: string; dot: string }> = {
  sm: { box: 'h-5 gap-1 px-2 text-[11px] [:lang(ar)_&]:text-xs', icon: 'size-3', dot: 'size-1.5' },
  md: { box: 'h-6 gap-1.5 px-2.5 text-small', icon: 'size-3.5', dot: 'size-1.5' },
  lg: { box: 'h-7 gap-1.5 px-3 text-small', icon: 'size-4', dot: 'size-2' },
};

export interface BadgeProps extends ComponentProps<'span'> {
  tone?: BadgeTone;
  variant?: BadgeVariant;
  size?: BadgeSize;
  /** Leading icon from the kit's set. */
  icon?: IconName;
  /** Leading status dot (ignored when `icon` is set). */
  dot?: boolean;
  /** Dot pulses for live states ("Syncing", "Live"); still under reduced motion. */
  pulse?: boolean;
  /** Translucent fill with blur, for badges over imagery or the dark brand panel. */
  glass?: boolean;
  children: ReactNode;
}

/** Bordered pill label. Server-renderable, no JS. */
export function Badge({ tone = 'neutral', variant = 'soft', size = 'md', icon, dot = false, pulse = false, glass = false, className, children, ...props }: BadgeProps) {
  const s = SIZES[size];
  const colours = variant === 'solid' ? SOLID[tone] : variant === 'outline' ? OUTLINE[tone] : SOFT[tone];
  return (
    <span
      data-slot="badge"
      data-tone={tone}
      data-variant={variant}
      className={cn(
        'inline-flex w-fit shrink-0 items-center rounded-pill border leading-none font-semibold whitespace-nowrap [&>svg]:shrink-0',
        s.box,
        colours,
        glass && variant !== 'solid' && 'backdrop-blur-md [background-color:color-mix(in_oklab,var(--card)_55%,transparent)]',
        className,
      )}
      {...props}
    >
      {icon ? (
        <Icon name={icon} className={s.icon} />
      ) : dot ? (
        <span aria-hidden="true" className={cn('relative inline-flex shrink-0 rounded-full', s.dot, variant === 'solid' ? 'bg-current' : DOT[tone])}>
          {pulse ? <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:animate-none', variant === 'solid' ? 'bg-current' : DOT[tone])} /> : null}
        </span>
      ) : null}
      {children}
    </span>
  );
}
