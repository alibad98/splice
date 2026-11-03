'use client';
// Tooltip: shadcn/ui tooltip on Radix Tooltip (MIT, via `radix-ui`), ink surface with background text.
import type { ComponentProps } from 'react';
import * as TooltipPrimitive from 'radix-ui/tooltip';
import { cn } from './cn.js';

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({ sideOffset = 6, className, children, ...props }: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-w-xs rounded-sm bg-foreground px-2.5 py-1.5 text-small font-medium text-background shadow-card origin-(--radix-tooltip-content-transform-origin) data-[state=delayed-open]:animate-pop-in data-[state=instant-open]:animate-pop-in data-[state=closed]:animate-pop-out',
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

