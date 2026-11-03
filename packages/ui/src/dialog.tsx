'use client';
// Dialog & Sheet (ConfirmDialog lives in alert-dialog.tsx): shadcn/ui dialog + sheet (MIT, https://github.com/shadcn-ui/ui) on Radix Dialog
// (MIT, via `radix-ui`), restyled to DESIGN.md. Focus is trapped, Escape closes, focus returns to the trigger.
// The sheet always enters from the inline-start edge (left in LTR, right in RTL).
import type { ComponentProps } from 'react';
import * as DialogPrimitive from 'radix-ui/dialog';
import { cn } from './cn.js';
import { Icon } from './icon.js';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn('fixed inset-0 z-50 bg-black/40 backdrop-blur-[3px] data-[state=open]:animate-scrim-in data-[state=closed]:animate-scrim-out', className)}
      {...props}
    />
  );
}

/** Close button in the corner; the label is passed by the app (ar/en). */
function CloseButton({ label }: { label: string }) {
  return (
    <DialogPrimitive.Close
      aria-label={label}
      className="absolute end-4 top-4 inline-flex size-9 items-center justify-center rounded-pill text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
    >
      <Icon name="close" className="size-4.5" />
    </DialogPrimitive.Close>
  );
}

export interface DialogContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  /** Accessible label for the corner close button; omit to hide the button. */
  closeLabel?: string;
}

export function DialogContent({ className, children, closeLabel, ...props }: DialogContentProps) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-6 overflow-y-auto overscroll-contain rounded-lg bg-card p-6 sm:p-7 text-card-foreground outline-none data-[state=open]:animate-alert-in data-[state=closed]:animate-alert-out',
          className,
        )}
        {...props}
      >
        {children}
        {closeLabel ? <CloseButton label={closeLabel} /> : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

// Anatomy: Header (title + description), Body (fields), Footer (actions); sections sit 24px apart.
export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-2 pe-10 text-start', className)} {...props} />;
}

export function DialogBody({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="dialog-body" className={cn('flex flex-col gap-4', className)} {...props} />;
}

/** Actions, divided from the body: full-width and stacked on phones (primary on top), inline at the end edge from `sm`. */
export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        '-mx-6 flex flex-col-reverse gap-2.5 border-t border-border px-6 pt-5 sm:-mx-7 sm:flex-row sm:justify-end sm:gap-3 sm:px-7',
        '*:data-[slot=button]:w-full sm:*:data-[slot=button]:w-auto sm:*:data-[slot=button]:min-w-24',
        className,
      )}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn('text-h2 text-balance text-foreground', className)} {...props} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="dialog-description" className={cn('text-body text-muted-foreground', className)} {...props} />;
}

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export interface SheetContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  closeLabel?: string;
}

export function SheetContent({ className, children, closeLabel, ...props }: SheetContentProps) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'fixed inset-y-0 start-0 z-50 flex h-dvh w-72 max-w-[85vw] flex-col gap-4 overflow-y-auto overscroll-contain bg-sidebar p-4 text-sidebar-foreground outline-none [--sheet-from:-100%] rtl:[--sheet-from:100%] data-[state=open]:animate-sheet-in data-[state=closed]:animate-sheet-out',
          className,
        )}
        {...props}
      >
        {children}
        {closeLabel ? <CloseButton label={closeLabel} /> : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export function SheetHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sheet-header" className={cn('flex min-h-11 items-center pe-10', className)} {...props} />;
}

export const SheetTitle = DialogTitle;
export const SheetDescription = DialogDescription;
