'use client';
// Switch: shadcn/ui switch on Radix Switch (MIT, via `radix-ui`), restyled to DESIGN.md tokens with RTL support.
import type { ComponentProps } from 'react';
import * as SwitchPrimitive from 'radix-ui/switch';
import { cn } from './cn.js';

export type SwitchProps = ComponentProps<typeof SwitchPrimitive.Root>;

export function Switch({ className, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-pill border border-input-border bg-muted p-0.5 transition-colors duration-150 ease-out hover:border-interaction disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-interaction data-[state=checked]:bg-interaction',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4.5 rounded-full bg-background shadow-xs transition-transform duration-150 ease-out data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0 rtl:data-[state=checked]:-translate-x-5"
      />
    </SwitchPrimitive.Root>
  );
}

