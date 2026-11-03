'use client';
// OtpInput: one-time verification code, one slot per digit. Always LTR (codes read left to right in Arabic too),
// keyboard (arrows, Backspace, Home/End), paste and SMS/iOS autofill aware. Inside a Field the group is labelled by it.
import { useEffect, useRef, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from './cn.js';
import { controlBase } from './control.js';
import { useFieldControl } from './field.js';

export interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  hasError?: boolean;
  /** Accessible label prefix for each digit slot, e.g. "Digit" / "الرقم" (announced as "Digit 3 of 6"). */
  digitLabel?: string;
  /** Word between the slot number and total, e.g. "of" / "من". */
  ofLabel?: string;
  /** Accessible name for the group when not inside a Field. */
  groupLabel?: string;
  /** Focus the first empty slot on mount. */
  autoFocus?: boolean;
  id?: string;
  className?: string;
}

export function OtpInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled = false,
  hasError = false,
  digitLabel = 'Digit',
  ofLabel = 'of',
  groupLabel,
  autoFocus = false,
  id,
  className,
}: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const field = useFieldControl({ id, invalid: hasError });
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  useEffect(() => {
    if (autoFocus) refs.current[Math.min(value.length, length - 1)]?.focus();
    // Mount only (empty deps): refocusing on every change would steal focus from the user.
  }, []);

  const focusAt = (index: number) => {
    const el = refs.current[Math.max(0, Math.min(index, length - 1))];
    el?.focus();
    el?.select();
  };

  const commit = (next: string) => {
    const clean = next.replace(/\D/g, '').slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
    return clean;
  };

  const setDigit = (index: number, digit: string) => {
    const chars = digits.slice();
    chars[index] = digit;
    // Digits are kept contiguous: clearing a middle slot removes that digit and the later ones shift back one slot.
    const joined = chars.join('');
    commit(digit ? joined : chars.slice(0, index).join('') + chars.slice(index + 1).join(''));
  };

  const handleChange = (index: number, e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (raw.length > 1) {
      // Autofill (iOS one-time-code) or fast typing put several digits into one slot: spread them from here.
      const clean = commit(value.slice(0, index) + raw);
      focusAt(clean.length);
      return;
    }
    if (raw) {
      // Digits stay contiguous, so a digit typed past the code so far lands in the next free slot.
      const target = Math.min(index, value.length);
      setDigit(target, raw);
      focusAt(target + 1);
      return;
    }
    // The slot was emptied without a Backspace keydown (Android soft keyboards send key "Unidentified", or a cut).
    if (e.target.value === '' && digits[index]) setDigit(index, '');
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (digits[index]) setDigit(index, '');
      else if (index > 0) {
        setDigit(index - 1, '');
        focusAt(index - 1);
      }
    } else if (e.key === 'Delete') {
      e.preventDefault();
      setDigit(index, '');
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusAt(index - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusAt(index + 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusAt(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusAt(value.length);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    // Text with no digits in it leaves the code as typed.
    if (!/\d/.test(e.clipboardData.getData('text'))) return;
    const clean = commit(e.clipboardData.getData('text'));
    focusAt(clean.length);
  };

  return (
    <div
      data-slot="otp-input"
      role="group"
      aria-label={groupLabel}
      aria-labelledby={groupLabel ? undefined : field.labelId}
      aria-describedby={field['aria-describedby']}
      dir="ltr"
      className={cn('flex items-center justify-center gap-2 sm:gap-2.5', className)}
    >
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          id={i === 0 ? field.id : undefined}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          pattern="[0-9]*"
          maxLength={i === 0 ? length : 1}
          aria-label={`${digitLabel} ${i + 1} ${ofLabel} ${length}`}
          aria-invalid={field.invalid || undefined}
          value={digit}
          disabled={disabled}
          onFocus={(e) => e.target.select()}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          data-filled={digit ? '' : undefined}
          className={cn(
            controlBase,
            'h-12 w-10 p-0 text-center text-h2 font-bold tabular-nums caret-primary sm:h-14 sm:w-12 sm:text-h2',
            'data-filled:border-foreground/50 data-filled:bg-muted/60',
          )}
        />
      ))}
    </div>
  );
}
