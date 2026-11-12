'use client';
// ErrorSummary: the list of form errors shown on submit (GOV.UK error-summary pattern, written from scratch).
// It is an alert that takes focus when it appears, so screen readers read it and keyboard users start from it;
// each item is a link that moves focus to its field.
import { useEffect, useRef, type ComponentProps, type MouseEvent, type ReactNode } from 'react';
import { cn } from './cn.js';
import { Icon } from './icon.js';

export interface ErrorSummaryItem {
  /** The id of the field the link focuses. */
  id: string;
  /** What is wrong, in the active language. */
  label: ReactNode;
}

export interface ErrorSummaryProps extends Omit<ComponentProps<'div'>, 'title'> {
  title: ReactNode;
  items: readonly ErrorSummaryItem[];
  /** Focus the summary when it mounts (default) and whenever `focusKey` changes, e.g. on every submit. */
  autoFocus?: boolean;
  focusKey?: unknown;
}

/** Danger summary with links to the invalid fields; `role="alert"`, focused on mount. Renders nothing without items. */
export function ErrorSummary({ title, items, autoFocus = true, focusKey, className, ...props }: ErrorSummaryProps) {
  const ref = useRef<HTMLDivElement>(null);
  const hasItems = items.length > 0;

  useEffect(() => {
    if (autoFocus && hasItems) ref.current?.focus();
  }, [autoFocus, hasItems, focusKey]);

  if (!hasItems) return null;

  const focusField = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const field = document.getElementById(id);
    if (!field) return;
    event.preventDefault();
    field.focus();
    field.scrollIntoView?.({ block: 'center' });
  };

  return (
    <div
      ref={ref}
      data-slot="error-summary"
      role="alert"
      tabIndex={-1}
      className={cn('flex items-start gap-3 rounded-md border border-destructive/25 bg-destructive-tint p-4 text-body text-foreground', className)}
      {...props}
    >
      <span className="mt-0.5 shrink-0 text-destructive-text">
        <Icon name="danger" className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="font-semibold leading-snug text-destructive-text">{title}</p>
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                onClick={(e) => focusField(e, item.id)}
                className="font-medium text-foreground underline underline-offset-2 hover:text-destructive-text"
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
