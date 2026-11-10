'use client';
// Checkbox: shadcn/ui checkbox on Radix Checkbox (MIT, via `radix-ui`), restyled to DESIGN.md tokens.
import type { ComponentProps } from 'react';
import * as CheckboxPrimitive from 'radix-ui/checkbox';
import { cn } from './cn.js';
import { Icon } from './icon.js';

export type CheckboxProps = ComponentProps<typeof CheckboxPrimitive.Root>;

export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer relative inline-flex size-[18px] shrink-0 cursor-pointer after:absolute after:-inset-1.5 items-center justify-center rounded-[5px] border border-input-border bg-background text-primary-foreground transition-colors duration-150 ease-out hover:border-foreground/60 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary aria-invalid:border-destructive',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="flex items-center justify-center text-current">
        <Icon name="check" className="size-3.5 stroke-[2.5]" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

