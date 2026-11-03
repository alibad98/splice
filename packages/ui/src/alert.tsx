// Alert: inline contextual feedback (info, success, warning, danger) with icon, text, optional retry/action and dismiss.
// Never relies on colour alone: every tone renders its semantic icon.
import type { ComponentProps, ReactNode } from 'react';
import { Button } from './button.js';
import { cn } from './cn.js';
import { Icon, type IconName } from './icon.js';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

export interface AlertAction {
  label: string;
  onClick: () => void;
  pending?: boolean;
}

export interface AlertProps extends Omit<ComponentProps<'div'>, 'title'> {
  tone?: AlertTone;
  title?: ReactNode;
  description?: ReactNode;
  /** Optional inline action button (e.g. Retry on a failed block). */
  action?: AlertAction;
  /** Optional dismiss handler; requires `dismissLabel` for accessibility. */
  onDismiss?: () => void;
  dismissLabel?: string;
}

const TONE_STYLES: Record<AlertTone, { container: string; title: string; icon: IconName }> = {
  info: {
    container: 'bg-primary-tint border-primary/25 text-foreground',
    title: 'text-info-text',
    icon: 'info',
  },
  success: {
    container: 'bg-success-tint border-success/25 text-foreground',
    title: 'text-success-text',
    icon: 'check-circle',
  },
  warning: {
    container: 'bg-warning-tint border-warning/35 text-foreground',
    title: 'text-warning-text',
    icon: 'warning',
  },
  danger: {
    container: 'bg-destructive-tint border-destructive/25 text-foreground',
    title: 'text-destructive-text',
    icon: 'danger',
  },
};

/** Inline alert with semantic icon, token tint, optional retry/action button, and optional dismiss control. */
export function Alert({
  tone = 'info',
  title,
  description,
  action,
  onDismiss,
  dismissLabel,
  role,
  className,
  children,
  ...props
}: AlertProps) {
  const style = TONE_STYLES[tone];
  return (
    <div
      data-slot="alert"
      data-tone={tone}
      // Errors and warnings interrupt; success and info are announced politely.
      role={role ?? (tone === 'danger' || tone === 'warning' ? 'alert' : 'status')}
      className={cn('relative flex items-start gap-3 rounded-md border p-4 text-body', style.container, className)}
      {...props}
    >
      <span className={cn('mt-0.5 shrink-0', style.title)}>
        <Icon name={style.icon} className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
        {title ? <p className={cn('font-semibold leading-snug', style.title)}>{title}</p> : null}
        {description ? <div className="text-body text-foreground leading-relaxed">{description}</div> : null}
        {children}
        {action ? (
          <div className="mt-1.5">
            <Button variant="secondary" size="sm" pending={Boolean(action.pending)} onClick={action.onClick} className="bg-background/80">
              {action.label}
            </Button>
          </div>
        ) : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-pill text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
        >
          <Icon name="close" className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

