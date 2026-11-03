'use client';
// Textarea: shadcn/ui textarea (MIT, https://github.com/shadcn-ui/ui) restyled to DESIGN.md `components.input`.
import { forwardRef, type ComponentProps } from 'react';
import { cn } from './cn.js';
import { controlBase } from './control.js';
import { useFieldControl } from './field.js';

export interface TextareaProps extends ComponentProps<'textarea'> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, id, 'aria-invalid': ariaInvalid, 'aria-describedby': describedBy, ...props },
  ref,
) {
  const field = useFieldControl({ id, 'aria-describedby': describedBy, invalid: Boolean(invalid || ariaInvalid === true || ariaInvalid === 'true') });
  return (
    <textarea
      ref={ref}
      id={field.id}
      data-slot="textarea"
      aria-invalid={field.invalid || undefined}
      aria-describedby={field['aria-describedby']}
      className={cn('flex min-h-24 w-full resize-y px-3.5 py-2.5', controlBase, className)}
      {...props}
    />
  );
});
