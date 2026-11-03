// EmptyState: calm, helpful empty view with optional icon, title, sentence and action/link; includes a compact filtered-empty variant.
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn.js';
import { Icon, type IconName } from './icon.js';

export interface EmptyStateProps extends Omit<ComponentProps<'div'>, 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  icon?: IconName;
  /** Primary action button or link node. */
  action?: ReactNode;
  /** `filtered` renders a compact single-sentence empty state for search/filter misses. */
  variant?: 'default' | 'filtered';
}

export function EmptyState({ title, description, icon, action, variant = 'default', className, children, ...props }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      data-variant={variant}
      className={cn('flex flex-col items-start gap-3 text-start', variant === 'filtered' ? 'py-6' : 'py-10', className)}
      {...props}
    >
      {icon ? (
        <span className="inline-flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon name={icon} className="size-5" />
        </span>
      ) : null}
      {title ? <h2 className="text-h2 text-foreground">{title}</h2> : null}
      {description ? <p className={cn('max-w-prose text-body', variant === 'filtered' && !title ? 'text-foreground' : 'text-muted-foreground')}>{description}</p> : null}
      {children}
      {action ? <div className="mt-1 flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

