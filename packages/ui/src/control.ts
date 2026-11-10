// Shared look for every text-like control (Input, Textarea, Select trigger, OTP slot) so they never drift apart.
// DESIGN.md `components.input`: 12px radius, input-border, teal focus outline (global :focus-visible), destructive on error.
// Text is 16px below `sm` so iOS Safari does not zoom the page on focus, 14px from `sm` up.

export const controlBase =
  'rounded-md border border-input-border bg-background text-base text-foreground sm:text-body ' +
  'transition-[border-color,box-shadow,background-color] duration-150 ease-out ' +
  'placeholder:text-muted-foreground hover:border-interaction focus-visible:border-interaction ' +
  'disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 disabled:hover:border-input-border ' +
  'aria-invalid:border-destructive aria-invalid:hover:border-destructive aria-invalid:focus-visible:border-destructive';

/** Heights: `md` 36px (default, dense pages), `lg` 44px (auth and touch-first forms). */
export const controlSizes = {
  md: 'h-9 px-3',
  lg: 'h-11 px-3.5',
} as const;

export type ControlSize = keyof typeof controlSizes;
