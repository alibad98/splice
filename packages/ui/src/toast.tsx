'use client';
// Toast + Toaster: shadcn/ui toast (MIT, https://github.com/shadcn-ui/ui) on Radix Toast (MIT, via `radix-ui`),
// restyled to DESIGN.md `components.toast` and the EXPERIENCE.md toast rules.
import { useSyncExternalStore, type ReactNode } from 'react';
import * as ToastPrimitive from 'radix-ui/toast';
import { cn } from './cn.js';

/** Plain toasts dismiss after this long; the timer pauses while the region is hovered or focused (Radix). */
export const TOAST_DURATION_MS = 5_000;

export type ToastTone = 'neutral' | 'success' | 'danger';

export interface ToastAction {
  label: string;
  /** How to do the same without the toast, for screen readers (Radix `altText`). Defaults to `label`. */
  altText?: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** Same id replaces the toast already shown (e.g. one failure toast per sync run). */
  id?: string;
  title: string;
  description?: string;
  tone?: ToastTone;
  /** A toast with an action never auto-dismisses. */
  action?: ToastAction;
}

export interface ToastItem extends ToastOptions {
  id: string;
  open: boolean;
}

// One store per JS realm: the app mounts one <Toaster />; `toast()` can be called from anywhere.
let items: ToastItem[] = [];
let counter = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const set = (next: ToastItem[]) => {
  items = next;
  emit();
};

/** Show a toast; returns its id. */
export function toast(options: ToastOptions): string {
  const id = options.id ?? `toast-${++counter}`;
  const item: ToastItem = { ...options, id, open: true };
  set(items.some((t) => t.id === id) ? items.map((t) => (t.id === id ? item : t)) : [...items, item]);
  return id;
}

/** Long enough for the exit transition (180 ms) to finish before a closed toast leaves the store. */
const EXIT_MS = 300;

/** Close a toast (or every toast). It leaves the store after its exit transition. */
toast.dismiss = (id?: string): void => {
  const closing = items.filter((t) => t.open && (id === undefined || t.id === id)).map((t) => t.id);
  if (closing.length === 0) return;
  set(items.map((t) => (closing.includes(t.id) ? { ...t, open: false } : t)));
  // Removed only if still closed (a toast re-shown under the same id in the meantime stays).
  setTimeout(() => set(items.filter((t) => !(closing.includes(t.id) && !t.open))), EXIT_MS);
};

/** The toasts currently in the store (tests, devtools). */
toast.list = (): readonly ToastItem[] => items;

/** Drop every toast at once (tests). */
toast.clear = (): void => set([]);

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => items;
// One stable empty list: a new array per call makes useSyncExternalStore warn (and can loop).
const EMPTY: ToastItem[] = [];
const serverSnapshot = (): ToastItem[] => EMPTY;

const TONE_ACCENT: Record<ToastTone, string> = {
  neutral: '',
  success: 'border-s-4 border-s-success',
  danger: 'border-s-4 border-s-destructive',
};

export interface ToasterProps {
  /** Region name; `{hotkey}` becomes "F8". The app passes its localized text. */
  label: string;
  /** Localized word announced with each toast (Radix default: "Notification"). */
  toastLabel?: string;
  /** Accessible name of each toast's close button. */
  closeLabel: string;
  /** Layout direction: toasts sit at the bottom-start corner and swipe out towards the inline start. */
  dir?: 'ltr' | 'rtl';
}

/**
 * The single toast region, mounted once (empty) at app load so announcements are never missed. Bottom-start corner,
 * `F8` moves focus into it, announced politely. Toasts with an action stay until dismissed; plain toasts leave after
 * 5 s. Enter/exit are CSS transitions that become instant under `prefers-reduced-motion`.
 */
export function Toaster({ label, toastLabel, closeLabel, dir = 'ltr' }: ToasterProps) {
  const list = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return (
    <ToastPrimitive.Provider duration={TOAST_DURATION_MS} swipeDirection={dir === 'rtl' ? 'right' : 'left'} {...(toastLabel ? { label: toastLabel } : {})}>
      {list.map((t) => (
        <ToastPrimitive.Root
          key={t.id}
          data-slot="toast"
          data-tone={t.tone ?? 'neutral'}
          // Every toast is announced politely (EXPERIENCE.md); action toasts persist.
          type="background"
          open={t.open}
          duration={t.action ? Infinity : TOAST_DURATION_MS}
          onOpenChange={(open) => (open ? undefined : toast.dismiss(t.id))}
          className={cn(
            'pointer-events-auto flex w-full items-start gap-3 rounded-md bg-foreground p-4 text-background shadow-card',
            'data-[state=open]:animate-toast-in data-[state=closed]:animate-toast-out data-[swipe=end]:animate-toast-out',
            'data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-transform',
            TONE_ACCENT[t.tone ?? 'neutral'],
          )}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <ToastPrimitive.Title className="font-semibold">{t.title}</ToastPrimitive.Title>
            {t.description ? <ToastPrimitive.Description className="text-small opacity-90">{t.description}</ToastPrimitive.Description> : null}
            {t.action ? (
              <ToastPrimitive.Action
                altText={t.action.altText ?? t.action.label}
                onClick={t.action.onClick}
                className="mt-2 inline-flex min-h-8 items-center self-start rounded-pill border border-primary px-3 text-small font-semibold text-background hover:bg-primary hover:text-primary-foreground"
              >
                {t.action.label}
              </ToastPrimitive.Action>
            ) : null}
          </div>
          <ToastPrimitive.Close aria-label={closeLabel} className="inline-flex size-6 shrink-0 items-center justify-center rounded-pill opacity-80 hover:opacity-100">
            <CloseIcon />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport
        data-slot="toaster"
        label={label}
        className="pointer-events-none fixed bottom-0 start-0 z-50 m-0 flex w-full max-w-[420px] list-none flex-col gap-2 p-4 outline-none"
      />
    </ToastPrimitive.Provider>
  );
}

function CloseIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
