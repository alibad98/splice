// Banner: page-level in-flow strip for persistent store states (warning = offline, danger = disconnected).
// Source: DESIGN.md `components.banner`.
import type { ComponentProps, ReactNode } from 'react';
import { Button } from './button.js';
import { cn } from './cn.js';
import { Icon, type IconName } from './icon.js';

export type BannerTone = 'warning' | 'danger';

export interface BannerAction {
  label: string;
  onClick?: () => void;
  href?: string;
  pending?: boolean;
}

export interface BannerProps extends ComponentProps<'div'> {
  tone: BannerTone;
  /** Primary banner message. */
  children: ReactNode;
  /** Single recovery action (e.g. "Reconnect store"). */
  action?: BannerAction;
}

const BANNER_TONES: Record<BannerTone, { strip: string; iconColor: string; icon: IconName }> = {
  warning: {
    strip: 'bg-warning-tint border-input-border text-foreground',
    iconColor: 'text-warning-text',
    icon: 'warning',
  },
  danger: {
    strip: 'bg-destructive-tint border-input-border text-foreground',
    iconColor: 'text-destructive-text',
    icon: 'danger',
  },
};

/** Full-width in-flow strip at the top of a page: tint + input-border + icon + message + one action. */
export function Banner({ tone, children, action, role, className, ...props }: BannerProps) {
  const t = BANNER_TONES[tone];
  return (
    <div
      data-slot="banner"
      data-tone={tone}
      role={role ?? (tone === 'danger' ? 'alert' : 'status')}
      className={cn('flex w-full flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 text-body', t.strip, className)}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className={cn('shrink-0', t.iconColor)}>
          <Icon name={t.icon} className="size-5" />
        </span>
        <div className="min-w-0 flex-1 font-medium">{children}</div>
      </div>
      {action ? (
        action.href ? (
          <a
            href={action.href}
            className="inline-flex min-h-8 shrink-0 items-center justify-center rounded-pill border border-input-border bg-background px-3 text-small font-semibold text-foreground transition-colors hover:bg-muted"
          >
            {action.label}
          </a>
        ) : (
          <Button variant="secondary" size="sm" pending={Boolean(action.pending)} onClick={action.onClick} className="bg-background">
            {action.label}
          </Button>
        )
      ) : null}
    </div>
  );
}

