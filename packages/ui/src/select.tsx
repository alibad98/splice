'use client';
// Select: shadcn/ui select (MIT, https://github.com/shadcn-ui/ui) on Radix Select (MIT, via `radix-ui`),
// restyled to DESIGN.md `components.input` and popover rules. Replaces all native `<select>` elements.
import type { ComponentProps, ReactNode } from 'react';
import * as SelectPrimitive from 'radix-ui/select';
import { cn } from './cn.js';
import { controlBase, controlSizes, type ControlSize } from './control.js';
import { useFieldControl } from './field.js';
import { Icon } from './icon.js';

/** Sentinel used so callers can pass `value=""` (e.g. "All categories") without hitting Radix's non-empty Item constraint. */
const EMPTY_SENTINEL = '__slips_empty__';
const toInternal = (v: string | undefined) => (v === '' ? EMPTY_SENTINEL : v);
const toExternal = (v: string) => (v === EMPTY_SENTINEL ? '' : v);

export interface SelectProps extends Omit<ComponentProps<typeof SelectPrimitive.Root>, 'value' | 'defaultValue' | 'onValueChange'> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

export function Select({ value, defaultValue, onValueChange, children, ...props }: SelectProps) {
  return (
    <SelectPrimitive.Root
      data-slot="select"
      {...(value !== undefined ? { value: toInternal(value) } : {})}
      {...(defaultValue !== undefined ? { defaultValue: toInternal(defaultValue) } : {})}
      onValueChange={(next) => onValueChange?.(toExternal(next))}
      {...props}
    >
      {children}
    </SelectPrimitive.Root>
  );
}

export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export interface SelectTriggerProps extends ComponentProps<typeof SelectPrimitive.Trigger> {
  size?: ControlSize;
  invalid?: boolean;
}

export function SelectTrigger({ size = 'md', invalid, id, 'aria-describedby': describedBy, className, children, ...props }: SelectTriggerProps) {
  const field = useFieldControl({ id, 'aria-describedby': describedBy, invalid });
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      id={field.id}
      aria-invalid={field.invalid || undefined}
      aria-describedby={field['aria-describedby']}
      className={cn(
        'group inline-flex w-full min-w-0 cursor-pointer items-center justify-between gap-2 text-start data-[placeholder]:text-muted-foreground data-[state=open]:border-foreground/60 [&>span]:truncate',
        controlBase,
        controlSizes[size],
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <Icon name="chevron-down" className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({ className, children, position = 'popper', ...props }: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        sideOffset={6}
        className={cn(
          'relative z-50 max-h-[min(18rem,var(--radix-select-content-available-height))] min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-card origin-(--radix-select-content-transform-origin) data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out',
          position === 'popper' && 'w-(--radix-select-trigger-width)',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectLabel({ className, ...props }: ComponentProps<typeof SelectPrimitive.Label>) {
  return <SelectPrimitive.Label data-slot="select-label" className={cn('px-2.5 py-1.5 text-small font-semibold text-muted-foreground', className)} {...props} />;
}

export interface SelectItemProps extends Omit<ComponentProps<typeof SelectPrimitive.Item>, 'value'> {
  value: string;
  children: ReactNode;
}

export function SelectItem({ value, className, children, ...props }: SelectItemProps) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      value={toInternal(value) ?? EMPTY_SENTINEL}
      className={cn(
        'relative flex min-h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-sm py-2 ps-3 pe-8 text-body text-foreground outline-none select-none focus-visible:shadow-none data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[state=checked]:font-semibold',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="absolute end-2.5 flex size-4 items-center justify-center text-primary">
        <SelectPrimitive.ItemIndicator>
          <Icon name="check" className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

export function SelectSeparator({ className, ...props }: ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator data-slot="select-separator" className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}

