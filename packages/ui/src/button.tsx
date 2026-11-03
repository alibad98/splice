// Button: shadcn/ui button (MIT, https://github.com/shadcn-ui/ui) restyled to DESIGN.md, with pending and
// unavailable-with-reason states (EXPERIENCE.md). No `asChild`; links stay `<a>`.
import { useId, type ComponentProps, type MouseEvent } from 'react';
import { cn } from './cn.js';
import { Spinner } from './spinner.js';

export type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  // Ink text on coral, always (DESIGN.md button text rule).
  primary: 'bg-primary text-primary-foreground hover:brightness-108',
  secondary: 'border border-input-border bg-transparent text-foreground hover:bg-muted',
  // Amber fill with dark text; one "make something" action per screen.
  accent: 'bg-accent text-accent-foreground hover:brightness-108',
  ghost: 'bg-transparent text-foreground hover:bg-muted',
  destructive: 'bg-destructive text-destructive-foreground hover:brightness-108',
};

const SIZES: Record<ButtonSize, string> = {
  // Button type steps, 13/14/15px (globals.css `--text-button*`), with tight leading so labels sit centred in the pill.
  sm: 'min-h-8 gap-1.5 px-3 text-button-sm',
  md: 'min-h-9 px-4 text-button',
  lg: 'min-h-11 px-5 text-button-lg',
};

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Working: shows a spinner, sets `aria-busy`, ignores clicks and Enter/Space; stays focusable (never native `disabled`). */
  pending?: boolean;
  /** The action cannot be used now: `aria-disabled`, focusable, and this reason is announced with the button. */
  unavailableReason?: string;
}

/** Pill button, 36px (32 sm, 44 lg). Hover brightens fills; unavailable and disabled read at 50% opacity. */
export function Button({ variant = 'secondary', size = 'md', pending = false, unavailableReason, className, children, onClick, type = 'button', disabled, 'aria-describedby': describedBy, ...props }: ButtonProps) {
  const reasonId = useId();
  const blocked = pending || Boolean(unavailableReason);
  const guard = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };
  // A function is only attached when there is one to guard (server components pass no handlers).
  const handleClick = blocked ? (onClick || type === 'submit' ? guard : undefined) : onClick;
  const describedByIds = [describedBy, unavailableReason ? reasonId : undefined].filter(Boolean).join(' ') || undefined;
  const button = (
    <button
      data-slot="button"
      data-variant={variant}
      type={type}
      disabled={disabled}
      aria-busy={pending || undefined}
      aria-disabled={blocked || undefined}
      aria-describedby={describedByIds}
      onClick={handleClick}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-pill font-semibold whitespace-nowrap transition-[filter,background-color] duration-150 ease-out select-none',
        VARIANTS[variant],
        SIZES[size],
        'disabled:opacity-50 disabled:hover:brightness-100',
        unavailableReason && 'cursor-not-allowed opacity-50 hover:brightness-100',
        pending && 'cursor-progress',
        className,
      )}
      {...props}
    >
      {pending ? <Spinner /> : null}
      {children}
    </button>
  );
  if (!unavailableReason) return button;
  // The reason sits outside the button so it describes it without joining its name; a hidden element still works for aria-describedby.
  return (
    <>
      {button}
      <span id={reasonId} hidden>
        {unavailableReason}
      </span>
    </>
  );
}
