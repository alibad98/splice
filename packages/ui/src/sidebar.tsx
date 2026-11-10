'use client';
// Sidebar: shadcn/ui sidebar (MIT, https://github.com/shadcn-ui/ui) trimmed to what the dashboard uses and restyled
// to DESIGN.md. Collapses to an icon rail (`collapsible="icon"`), pinned to the inline-start edge of the viewport in
// both directions. The open state lives in a cookie so the server renders the right width on first paint (no shift).
// Below md the same content opens in the Sheet from the inline start.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type CSSProperties, type ComponentProps } from 'react';
import { Slot } from 'radix-ui/slot';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './dialog.js';
import { cn } from './cn.js';
import { Icon } from './icon.js';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip.js';

import { SIDEBAR_COOKIE } from './sidebar-state.js';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const WIDTH = '15rem';
/** 44px buttons + 12px padding on both sides. */
const WIDTH_ICON = '4.25rem';
const SHORTCUT_CODE = 'KeyB';
const MOBILE_QUERY = '(max-width: 767px)';

interface SidebarContextValue {
  state: 'expanded' | 'collapsed';
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  toggleSidebar: () => void;
  dir: 'ltr' | 'rtl';
}

const SidebarContext = createContext<SidebarContextValue | null>(null);
/** True inside the mobile sheet: menu buttons close it on click and never show tooltips. */
const InSheetContext = createContext(false);

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used within <SidebarProvider>');
  return ctx;
}

export interface SidebarProviderProps extends ComponentProps<'div'> {
  /** Initial state, read from the `sidebar_state` cookie on the server. */
  defaultOpen?: boolean;
  /** Layout direction: tooltips open towards the inline end. */
  dir?: 'ltr' | 'rtl';
}

export function SidebarProvider({ defaultOpen = true, dir = 'ltr', className, style, children, ...props }: SidebarProviderProps) {
  const [open, setOpenState] = useState(defaultOpen);
  const [openMobile, setOpenMobile] = useState(false);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
  }, []);

  const toggleSidebar = useCallback(() => {
    if (window.matchMedia(MOBILE_QUERY).matches) setOpenMobile((v) => !v);
    else setOpen(!open);
  }, [open, setOpen]);

  // Ctrl/Cmd + B, as in shadcn. Ignored while typing so it never eats bold in a text field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // `code` is the physical key, so the shortcut also works on an Arabic layout (where `key` is not "b").
      if (event.code !== SHORTCUT_CODE || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      event.preventDefault();
      toggleSidebar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar]);

  const value = useMemo<SidebarContextValue>(
    () => ({ state: open ? 'expanded' : 'collapsed', open, setOpen, openMobile, setOpenMobile, toggleSidebar, dir }),
    [open, setOpen, openMobile, toggleSidebar, dir],
  );

  return (
    <SidebarContext.Provider value={value}>
      <TooltipProvider delayDuration={0}>
        <div
          data-slot="sidebar-wrapper"
          style={{ '--sidebar-width': WIDTH, '--sidebar-width-icon': WIDTH_ICON, ...style } as CSSProperties}
          className={cn('group/sidebar-wrapper flex min-h-dvh w-full', className)}
          {...props}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  );
}

export interface SidebarProps extends ComponentProps<'div'> {
  /** Accessible name and description of the mobile sheet. */
  mobileTitle: string;
  mobileDescription?: string;
  /** Accessible name of the mobile sheet's close button. */
  closeLabel: string;
}

/** Desktop: a fixed rail whose width animates (a spacer in flow moves the content with it). Mobile: a sheet. */
export function Sidebar({ mobileTitle, mobileDescription, closeLabel, className, children, ...props }: SidebarProps) {
  const { state, openMobile, setOpenMobile, dir } = useSidebar();
  return (
    <>
      <div data-slot="sidebar" data-state={state} data-collapsible={state === 'collapsed' ? 'icon' : ''} className="group peer hidden text-sidebar-foreground md:block">
        {/* Spacer in the flow: the content beside the sidebar follows its width. */}
        <div
          data-slot="sidebar-gap"
          className="w-(--sidebar-width) transition-[width] duration-200 ease-out-soft group-data-[collapsible=icon]:w-(--sidebar-width-icon)"
        />
        <div
          data-slot="sidebar-container"
          className={cn(
            'fixed inset-y-0 start-0 z-20 flex h-dvh w-(--sidebar-width) flex-col border-e border-sidebar-border bg-sidebar transition-[width] duration-200 ease-out-soft group-data-[collapsible=icon]:w-(--sidebar-width-icon)',
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </div>
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent closeLabel={closeLabel} dir={dir} className="w-(--sidebar-width) gap-0 p-0" style={{ '--sidebar-width': '18rem' } as CSSProperties}>
          <SheetTitle className="sr-only">{mobileTitle}</SheetTitle>
          {mobileDescription ? <SheetDescription className="sr-only">{mobileDescription}</SheetDescription> : null}
          <InSheetContext.Provider value={true}>
            <div className="flex size-full flex-col">{children}</div>
          </InSheetContext.Provider>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Toggle button for the header: collapses the rail on desktop, opens the sheet on mobile. */
export function SidebarTrigger({ className, onClick, ...props }: ComponentProps<'button'>) {
  const { toggleSidebar } = useSidebar();
  return (
    <button
      type="button"
      data-slot="sidebar-trigger"
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-pill text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground',
        className,
      )}
      {...props}
    >
      <Icon name="sidebar" className="size-5" />
    </button>
  );
}

/** Thin grab strip on the sidebar's inline-end edge: click to collapse or expand. Pointer only; the trigger is the keyboard path. */
export function SidebarRail({ label, className }: { label: string; className?: string }) {
  const { toggleSidebar } = useSidebar();
  return (
    <button
      type="button"
      data-slot="sidebar-rail"
      aria-label={label}
      title={label}
      tabIndex={-1}
      onClick={toggleSidebar}
      className={cn(
        'absolute inset-y-0 -end-2 z-20 hidden w-4 cursor-col-resize after:absolute after:inset-y-0 after:start-1/2 after:w-0.5 after:-translate-x-1/2 rtl:after:translate-x-1/2 after:rounded-pill after:bg-transparent after:transition-colors after:duration-150 hover:after:bg-sidebar-border md:flex',
        className,
      )}
    />
  );
}

/** The page beside the sidebar. */
export function SidebarInset({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sidebar-inset" className={cn('relative flex min-w-0 flex-1 flex-col bg-page', className)} {...props} />;
}

export function SidebarHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sidebar-header" className={cn('flex flex-col gap-2 p-3', className)} {...props} />;
}

export function SidebarFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sidebar-footer" className={cn('mt-auto flex flex-col gap-2 border-t border-sidebar-border p-3', className)} {...props} />;
}

export function SidebarContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sidebar-content" className={cn('flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto px-3 py-2', className)} {...props} />;
}

export function SidebarMenu({ className, ...props }: ComponentProps<'ul'>) {
  return <ul data-slot="sidebar-menu" className={cn('flex w-full min-w-0 flex-col gap-1', className)} {...props} />;
}

export function SidebarMenuItem({ className, ...props }: ComponentProps<'li'>) {
  return <li data-slot="sidebar-menu-item" className={cn('relative', className)} {...props} />;
}

export type SidebarMenuButtonTone = 'default' | 'danger';

export interface SidebarMenuButtonProps extends ComponentProps<'button'> {
  asChild?: boolean;
  isActive?: boolean;
  /** Shown as a tooltip on the inline-end side while the rail is collapsed. */
  tooltip?: string;
  tone?: SidebarMenuButtonTone;
}

/**
 * 44px pill. Fixed 12px inline padding keeps the icon on one axis while the width animates, so collapsing just
 * clips the label (which also fades) instead of re-laying out the row.
 */
export function SidebarMenuButton({ asChild = false, isActive = false, tooltip, tone = 'default', className, onClick, children, ...props }: SidebarMenuButtonProps) {
  const { state, setOpenMobile, dir } = useSidebar();
  const inSheet = useContext(InSheetContext);
  const Comp = asChild ? Slot : 'button';
  const button = (
    <Comp
      data-slot="sidebar-menu-button"
      data-active={isActive}
      data-tone={tone}
      {...(asChild ? {} : { type: 'button' as const })}
      onClick={(event: Parameters<NonNullable<typeof onClick>>[0]) => {
        onClick?.(event);
        if (inSheet) setOpenMobile(false);
      }}
      className={cn(
        'flex h-11 w-full items-center gap-3 overflow-hidden rounded-pill px-3 text-start text-body font-semibold whitespace-nowrap text-sidebar-foreground transition-[background-color,color,width] duration-150',
        'hover:bg-sidebar-accent',
        'data-[active=true]:bg-primary data-[active=true]:text-primary-foreground',
        'data-[tone=danger]:text-muted-foreground data-[tone=danger]:hover:bg-destructive-tint data-[tone=danger]:hover:text-destructive-text',
        'group-data-[collapsible=icon]:w-11',
        '[&>span]:transition-opacity [&>span]:duration-200 group-data-[collapsible=icon]:[&>span]:opacity-0',
        className,
      )}
      {...props}
    >
      {children}
    </Comp>
  );
  if (!tooltip || inSheet) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side={dir === 'rtl' ? 'left' : 'right'} align="center" hidden={state !== 'collapsed'}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

