'use client';
// Label & Field: shadcn/ui label (MIT, https://github.com/shadcn-ui/ui, on Radix Label) and a form field wrapper.
// Field owns the ids: the control inside (Input, PasswordInput, Textarea, SelectTrigger, OtpInput) picks up its
// `id`, `aria-describedby` (hint or error) and `aria-invalid` from context, so callers never wire them by hand.
import { createContext, useContext, useId, type ComponentProps, type ReactNode } from 'react';
import * as LabelPrimitive from 'radix-ui/label';
import { cn } from './cn.js';

export type LabelProps = ComponentProps<typeof LabelPrimitive.Root>;

export function Label({ className, ...props }: LabelProps) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn('text-small font-semibold text-foreground select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50', className)}
      {...props}
    />
  );
}

interface FieldContextValue {
  controlId: string;
  descriptionId?: string;
  invalid: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/**
 * Props a control merges in when it sits inside a Field. Explicit props on the control always win.
 * @internal used by the kit's form controls.
 */
export function useFieldControl(props: { id?: string; 'aria-describedby'?: string; invalid?: boolean }) {
  const field = useContext(FieldContext);
  const describedBy = [props['aria-describedby'], field?.descriptionId].filter(Boolean).join(' ') || undefined;
  return {
    id: props.id ?? field?.controlId,
    'aria-describedby': describedBy,
    invalid: Boolean(props.invalid || field?.invalid),
    /** Id of the Field label, for controls that are groups (OTP). */
    labelId: field ? `${field.controlId}-label` : undefined,
  };
}

export interface FieldProps extends Omit<ComponentProps<'div'>, 'label'> {
  /** Field label text or element. */
  label: ReactNode;
  /** ID of the control; generated when omitted. */
  htmlFor?: string;
  /** Optional node aligned at the inline-end of the label row (e.g. "Forgot password?" link). */
  labelAction?: ReactNode;
  /** Validation error; shown in destructive text below the control, announced, and marks the control invalid. */
  error?: ReactNode;
  /** Helper note shown when there is no error. */
  hint?: ReactNode;
  /** ID for the hint/error node; generated when omitted. */
  descriptionId?: string;
}

export function Field({ label, htmlFor, labelAction, error, hint, descriptionId, className, children, ...props }: FieldProps) {
  const autoId = useId();
  const controlId = htmlFor ?? `${autoId}-control`;
  const descId = descriptionId ?? `${autoId}-description`;
  const hasDescription = Boolean(error || hint);
  return (
    <FieldContext.Provider value={{ controlId, descriptionId: hasDescription ? descId : undefined, invalid: Boolean(error) }}>
      <div data-slot="field" data-invalid={error ? '' : undefined} className={cn('flex w-full flex-col gap-1.5 text-start', className)} {...props}>
        <div className="flex min-h-5 items-center justify-between gap-2">
          <Label id={`${controlId}-label`} htmlFor={controlId}>
            {label}
          </Label>
          {labelAction ? <div className="shrink-0 text-small">{labelAction}</div> : null}
        </div>
        {children}
        {error ? (
          <p id={descId} role="alert" data-slot="field-error" className="flex items-start gap-1.5 text-small font-medium leading-snug text-destructive-text">
            {error}
          </p>
        ) : hint ? (
          <p id={descId} data-slot="field-hint" className="text-small leading-snug text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}
