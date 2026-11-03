'use client';
// AlertDialog, ConfirmDialog and the global `dialog.confirm()`: shadcn/ui alert-dialog (MIT, https://github.com/shadcn-ui/ui)
// on Radix AlertDialog (MIT, via `radix-ui`), restyled to DESIGN.md. Outside clicks never dismiss; Escape and Cancel do.
// Cancel takes initial focus so Enter never confirms by accident. An async `onConfirm` keeps the dialog open and
// pending until it settles. Motion: the panel rises out of a soft blur, then one ripple leaves the tone medallion.
import { useSyncExternalStore, type ReactNode } from 'react';
import * as AlertDialogPrimitive from 'radix-ui/alert-dialog';
import { Button } from './button.js';
import { cn } from './cn.js';
import { Icon, type IconName } from './icon.js';

export type DialogTone = 'neutral' | 'warning' | 'danger';

const TONE: Record<DialogTone, { icon: IconName; medallion: string; ripple: string }> = {
  neutral: { icon: 'info', medallion: 'bg-primary-tint text-info-text', ripple: 'border-primary' },
  warning: { icon: 'warning', medallion: 'bg-warning-tint text-warning-text', ripple: 'border-warning' },
  danger: { icon: 'danger', medallion: 'bg-destructive-tint text-destructive-text', ripple: 'border-destructive' },
};

export interface AlertDialogViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  tone?: DialogTone;
  /** Overrides the tone's icon (e.g. `logout`). */
  icon?: IconName;
  pending?: boolean;
  dir?: 'ltr' | 'rtl';
}

/** The one alert-dialog look: tone medallion, title, description, Cancel + confirm. */
export function AlertDialogView({ open, onOpenChange, title, description, confirmLabel, cancelLabel, onConfirm, tone = 'neutral', icon, pending = false, dir }: AlertDialogViewProps) {
  const t = TONE[tone];
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay
          data-slot="alert-dialog-overlay"
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[3px] data-[state=open]:animate-scrim-in data-[state=closed]:animate-scrim-out"
        />
        <AlertDialogPrimitive.Content
          data-slot="dialog-content"
          data-tone={tone}
          dir={dir}
          onEscapeKeyDown={(event) => (pending ? event.preventDefault() : undefined)}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-104 -translate-x-1/2 -translate-y-1/2 flex-col gap-7 overflow-y-auto overscroll-contain rounded-lg bg-card p-6 sm:p-7 text-card-foreground outline-none data-[state=open]:animate-alert-in data-[state=closed]:animate-alert-out"
        >
          <div className="flex flex-col items-start gap-5">
            <span className={cn('relative inline-flex size-12 shrink-0 items-center justify-center rounded-pill', t.medallion)}>
              <span aria-hidden="true" className={cn('absolute inset-0 rounded-pill border-2 opacity-0 animate-medallion-ripple', t.ripple)} />
              <Icon name={icon ?? t.icon} className="size-6 animate-medallion-icon" />
            </span>
            <div className="flex flex-col gap-2 text-start">
              <AlertDialogPrimitive.Title className="text-h2 text-balance text-foreground">{title}</AlertDialogPrimitive.Title>
              {description ? (
                <AlertDialogPrimitive.Description className="text-body text-pretty text-muted-foreground">{description}</AlertDialogPrimitive.Description>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="secondary" size="lg" className="order-2 sm:order-1">
                {cancelLabel}
              </Button>
            </AlertDialogPrimitive.Cancel>
            {/* Not Radix `Action`: that closes on click, and an async confirm must stay open while it runs. */}
            <Button variant={tone === 'danger' ? 'destructive' : 'primary'} size="lg" pending={pending} onClick={onConfirm} className="order-1 sm:order-2">
              {confirmLabel}
            </Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Names the item, e.g. "Delete “Summer Abaya” story?" */
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  /** Destructive confirms use the danger tone; default true. Ignored when `tone` is set. */
  destructive?: boolean;
  tone?: DialogTone;
  icon?: IconName;
  pending?: boolean;
  dir?: 'ltr' | 'rtl';
}

/** Controlled confirm step for destructive or irreversible actions. */
export function ConfirmDialog({ destructive = true, tone, ...props }: ConfirmDialogProps) {
  return <AlertDialogView tone={tone ?? (destructive ? 'danger' : 'neutral')} {...props} />;
}

// ---- Global imperative dialog -------------------------------------------------------------------------------------

export interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  tone?: DialogTone;
  icon?: IconName;
  /** Runs on confirm. A promise keeps the dialog open and pending; if it rejects the dialog stays open. */
  onConfirm?: () => unknown;
}

interface DialogItem extends ConfirmOptions {
  key: number;
  open: boolean;
  pending: boolean;
  resolve: (confirmed: boolean) => void;
}

// One store per JS realm: the app mounts one <DialogHost />; `dialog.confirm()` can be called from anywhere.
let current: DialogItem | null = null;
let counter = 0;
const listeners = new Set<() => void>();
const set = (next: DialogItem | null) => {
  current = next;
  for (const l of listeners) l();
};
/** Long enough for the exit animation (160 ms) before the closed dialog leaves the store. */
const EXIT_MS = 220;

const close = (confirmed: boolean) => {
  const item = current;
  if (!item?.open) return;
  item.resolve(confirmed);
  set({ ...item, open: false, pending: false });
  setTimeout(() => {
    if (current?.key === item.key) set(null);
  }, EXIT_MS);
};

const confirmCurrent = async () => {
  const item = current;
  if (!item?.open || item.pending) return;
  if (!item.onConfirm) return close(true);
  set({ ...item, pending: true });
  try {
    await item.onConfirm();
    if (current?.key === item.key) close(true);
  } catch {
    // The caller owns the error message (usually a toast); the dialog stays so they can retry or cancel.
    if (current?.key === item.key) set({ ...current, pending: false });
  }
};

export const dialog = {
  /** Ask before an action. Resolves true once confirmed (after `onConfirm` settles), false on cancel or Escape. */
  confirm(options: ConfirmOptions): Promise<boolean> {
    current?.resolve(false);
    return new Promise<boolean>((resolve) => set({ ...options, key: ++counter, open: true, pending: false, resolve }));
  },
  /** Close the open dialog as cancelled. */
  dismiss: (): void => close(false),
  /** The dialog currently in the store (tests). */
  current: (): Readonly<DialogItem> | null => current,
  /** Drop it at once (tests). */
  clear: (): void => {
    current?.resolve(false);
    set(null);
  },
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => current;
const serverSnapshot = () => null;

/** Mounted once next to the Toaster; renders whatever `dialog.confirm()` asked for. */
export function DialogHost({ dir }: { dir?: 'ltr' | 'rtl' }) {
  // A closed item stays in the store through its exit animation, then leaves.
  const item = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  if (!item) return null;
  return (
    <AlertDialogView
      key={item.key}
      open={item.open}
      onOpenChange={(open) => (open ? undefined : close(false))}
      title={item.title}
      description={item.description}
      confirmLabel={item.confirmLabel}
      cancelLabel={item.cancelLabel}
      tone={item.tone}
      icon={item.icon}
      pending={item.pending}
      onConfirm={() => void confirmCurrent()}
      dir={dir}
    />
  );
}
