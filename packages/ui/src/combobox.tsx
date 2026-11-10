'use client';
// Combobox: a search input with a popup listbox (WAI-ARIA APG "combobox with listbox popup", list autocomplete) on Radix
// Popover (MIT, via `radix-ui`), restyled to DESIGN.md `components.input` and popover rules. Focus never leaves the input:
// arrows move the active option (`aria-activedescendant`), Enter picks it, Escape closes and keeps the typed text.
// Options, filtering and loading are the caller's (e.g. a debounced API search); copy comes from props.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import * as PopoverPrimitive from 'radix-ui/popover';
import { cn } from './cn.js';
import { Input, type InputSize } from './input.js';

export type ComboboxStatus = 'ready' | 'loading' | 'error';

export interface ComboboxProps<T> {
  /** The typed text (controlled). */
  inputValue: string;
  onInputValueChange: (value: string) => void;
  /** Options to show for the current text; the caller filters or searches. */
  options: readonly T[];
  /** Stable key of an option (e.g. its id). */
  getOptionKey: (option: T) => string;
  /** Option content; merchant text inside should carry `dir="auto"`. */
  renderOption: (option: T) => ReactNode;
  /** An option was picked (Enter or click). The popup closes and focus stays on the input. */
  onSelect: (option: T) => void;
  /** Controlled open state; uncontrolled when omitted. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Open the popup when the input gains focus (default false: typing, ArrowDown or a click opens it). */
  openOnFocus?: boolean;
  /** `loading` with no options shows `loadingContent`; `error` shows `errorContent` (e.g. a message and Retry). */
  status?: ComboboxStatus;
  /** Shown when `status` is ready and there are no options (e.g. "No products match"). */
  emptyContent: ReactNode;
  loadingContent?: ReactNode;
  errorContent?: ReactNode;
  /** Accessible name of the listbox. */
  listLabel: string;
  id?: string;
  placeholder?: string;
  size?: InputSize;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
  className?: string;
}

export function Combobox<T>({
  inputValue,
  onInputValueChange,
  options,
  getOptionKey,
  renderOption,
  onSelect,
  open: openProp,
  onOpenChange,
  openOnFocus = false,
  status = 'ready',
  emptyContent,
  loadingContent,
  errorContent,
  listLabel,
  id,
  placeholder,
  size = 'md',
  disabled,
  invalid,
  autoFocus,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
  className,
}: ComboboxProps<T>) {
  const listId = useId();
  const [openState, setOpenState] = useState(false);
  const open = (openProp ?? openState) && !disabled;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };
  const [active, setActive] = useState(-1);
  const anchorRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // New results (or a closed popup) start with nothing active.
  const optionKeys = options.map(getOptionKey).join('\u0000');
  useEffect(() => setActive(-1), [optionKeys, open]);

  const optionId = (index: number) => `${listId}-option-${index}`;
  useEffect(() => {
    if (active < 0) return;
    const el = document.getElementById(optionId(active));
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active, listId]);

  const pick = (index: number) => {
    const option = options[index];
    if (option === undefined) return;
    onSelect(option);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = options.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        setActive((i) => (last < 0 ? -1 : Math.min(i + 1, last)));
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        setActive((i) => (last < 0 ? -1 : Math.max(i - 1, 0)));
        return;
      case 'Enter':
        // Never submits the surrounding form.
        event.preventDefault();
        if (open && active >= 0) pick(active);
        return;
      case 'Escape':
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
        return;
      case 'Tab':
        if (open) setOpen(false);
        return;
    }
  };

  const activeId = open && active >= 0 && active < options.length ? optionId(active) : undefined;
  const showOptions = options.length > 0 && status !== 'error';
  const message = status === 'error' ? errorContent : options.length > 0 ? null : status === 'loading' ? loadingContent : emptyContent;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <div ref={anchorRef} data-slot="combobox" className={cn('w-full', className)}>
          <Input
            id={id}
            type="text"
            role="combobox"
            dir="auto"
            autoComplete="off"
            spellCheck={false}
            size={size}
            leadingIcon="search"
            placeholder={placeholder}
            disabled={disabled}
            invalid={invalid}
            autoFocus={autoFocus}
            aria-label={ariaLabel}
            aria-describedby={describedBy}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={activeId}
            value={inputValue}
            onChange={(event) => {
              onInputValueChange(event.target.value);
              if (!open) setOpen(true);
            }}
            onFocus={() => {
              if (openOnFocus && !open) setOpen(true);
            }}
            onClick={() => {
              if (!open) setOpen(true);
            }}
            onBlur={(event) => {
              // Focus moving into the popup (e.g. a Retry button) keeps it open.
              if (contentRef.current?.contains(event.relatedTarget as Node | null)) return;
              if (open) setOpen(false);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={contentRef}
          data-slot="combobox-content"
          align="start"
          sideOffset={6}
          // Focus stays in the input while the popup is open and after it closes.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (anchorRef.current?.contains(event.target as Node | null)) event.preventDefault();
          }}
          className={cn(
            'z-50 flex max-h-[min(22rem,var(--radix-popover-content-available-height))] w-(--radix-popover-trigger-width) min-w-56 flex-col overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-card',
            'origin-(--radix-popover-content-transform-origin) data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out',
          )}
        >
          {showOptions ? (
            <div role="listbox" id={listId} aria-label={listLabel} aria-busy={status === 'loading' || undefined} className="overflow-y-auto p-1">
              {options.map((option, index) => (
                <div
                  key={getOptionKey(option)}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  data-active={index === active ? '' : undefined}
                  // Keep focus in the input; the click picks.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => setActive(index)}
                  onClick={() => pick(index)}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 text-body transition-colors duration-120 data-active:bg-interaction-tint"
                >
                  {renderOption(option)}
                </div>
              ))}
            </div>
          ) : (
            <div id={listId} role="listbox" aria-label={listLabel} className="hidden" />
          )}
          {message ? (
            <div role="status" data-slot="combobox-message" className="px-3 py-3 text-small text-muted-foreground">
              {message}
            </div>
          ) : null}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
