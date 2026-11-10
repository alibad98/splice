'use client';
// Tabs / Segmented Control: shadcn/ui tabs on Radix Tabs (MIT, via `radix-ui`), restyled to DESIGN.md `rounded.md` segment rules.
import type { ComponentProps } from 'react';
import * as TabsPrimitive from 'radix-ui/tabs';
import { cn } from './cn.js';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('inline-flex min-h-9 items-center justify-center gap-1 rounded-md bg-muted p-1 text-muted-foreground', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex min-h-7 cursor-pointer items-center justify-center rounded-sm px-3 py-1 text-small font-semibold whitespace-nowrap text-muted-foreground transition-[background-color,color,box-shadow] duration-150 ease-out hover:text-interaction disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-interaction-tint data-[state=active]:text-interaction data-[state=active]:shadow-xs',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('mt-3', className)} {...props} />;
}

