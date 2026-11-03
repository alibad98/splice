'use client';
// Input & PasswordInput: shadcn/ui input (MIT, https://github.com/shadcn-ui/ui) restyled to DESIGN.md `components.input`.
// 36px (`md`) or 44px (`lg`); inside a Field it gets its id, description and invalid state automatically.
import { forwardRef, useState, type ComponentProps, type ReactNode } from 'react';
import { cn } from './cn.js';
import { controlBase, controlSizes, type ControlSize } from './control.js';
import { useFieldControl } from './field.js';
import { Icon, type IconName } from './icon.js';

export type InputSize = ControlSize;

export interface InputProps extends Omit<ComponentProps<'input'>, 'size'> {
  size?: InputSize;
  leadingIcon?: IconName;
  /** Interactive node at the inline end (e.g. a reveal or clear button). Keep it 28px+ and labelled. */
  trailingSlot?: ReactNode;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', leadingIcon, trailingSlot, invalid, className, id, 'aria-invalid': ariaInvalid, 'aria-describedby': describedBy, ...props },
  ref,
) {
  const field = useFieldControl({ id, 'aria-describedby': describedBy, invalid: Boolean(invalid || ariaInvalid === true || ariaInvalid === 'true') });
  const inputEl = (
    <input
      ref={ref}
      id={field.id}
      data-slot="input"
      data-size={size}
      aria-invalid={field.invalid || undefined}
      aria-describedby={field['aria-describedby']}
      className={cn('w-full min-w-0', controlBase, controlSizes[size], leadingIcon && (props.dir === 'auto' ? 'px-9.5' : 'ps-9.5'), trailingSlot && (size === 'lg' ? 'pe-12' : 'pe-10'), className)}
      {...props}
    />
  );

  if (!leadingIcon && !trailingSlot) return inputEl;

  return (
    // The icon follows the page direction. With `dir="auto"` the text may run either way, so it is padded on both sides.
    <div data-slot="input-group" dir={props.dir === 'auto' ? undefined : props.dir} className="relative flex w-full items-center">
      {leadingIcon ? (
        <span className="pointer-events-none absolute start-3 flex items-center text-muted-foreground">
          <Icon name={leadingIcon} className="size-4" />
        </span>
      ) : null}
      {inputEl}
      {trailingSlot ? <span className="absolute end-1.5 flex items-center">{trailingSlot}</span> : null}
    </div>
  );
});

export interface PasswordInputProps extends Omit<InputProps, 'type' | 'trailingSlot'> {
  /** Accessible label for showing the password. */
  showLabel: string;
  /** Accessible label for hiding the password. */
  hideLabel: string;
}

/** Password field with a keyboard-reachable reveal toggle (`aria-pressed`), labelled by the app in ar/en. */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput({ showLabel, hideLabel, size = 'md', ...props }, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <Input
      {...props}
      size={size}
      ref={ref}
      type={visible ? 'text' : 'password'}
      trailingSlot={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          disabled={props.disabled}
          aria-label={visible ? hideLabel : showLabel}
          aria-pressed={visible}
          className={cn(
            'inline-flex items-center justify-center rounded-pill text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
            size === 'lg' ? 'size-8' : 'size-7',
          )}
        >
          <Icon name={visible ? 'eye-off' : 'eye'} className="size-4" />
        </button>
      }
    />
  );
});
