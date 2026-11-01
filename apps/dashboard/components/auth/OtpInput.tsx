'use client';

import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';

interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  hasError?: boolean;
}

export function OtpInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled = false,
  hasError = false,
}: OtpInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusedIndex, setFocusedIndex] = useState<number>(0);

  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  useEffect(() => {
    // Focus first input on mount if empty
    if (!value) {
      inputRefs.current[0]?.focus();
    }
  }, [value]);

  const updateDigit = (index: number, newChar: string) => {
    const chars = value.split('');
    chars[index] = newChar;
    const nextVal = chars.slice(0, length).join('').trimEnd();
    onChange(nextVal);

    if (newChar && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    if (nextVal.length === length && onComplete) {
      onComplete(nextVal);
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!digits[index] && index > 0) {
        inputRefs.current[index - 1]?.focus();
        updateDigit(index - 1, '');
      } else {
        updateDigit(index, '');
      }
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
      e.preventDefault();
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
      e.preventDefault();
    }
  };

  const handleChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const lastChar = raw.slice(-1);
    if (/^[0-9]$/.test(lastChar)) {
      updateDigit(index, lastChar);
    } else if (raw === '') {
      updateDigit(index, '');
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').trim();
    const cleanNumbers = pasted.replace(/\D/g, '').slice(0, length);
    if (cleanNumbers) {
      onChange(cleanNumbers);
      const targetIndex = Math.min(cleanNumbers.length, length - 1);
      inputRefs.current[targetIndex]?.focus();
      if (cleanNumbers.length === length && onComplete) {
        onComplete(cleanNumbers);
      }
    }
  };

  return (
    <div className="flex items-center justify-center gap-2 sm:gap-3" dir="ltr">
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            inputRefs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          pattern="[0-9]*"
          maxLength={1}
          value={digit}
          disabled={disabled}
          onFocus={() => setFocusedIndex(i)}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          className={`w-11 sm:w-12 h-14 sm:h-16 text-center text-xl sm:text-2xl font-bold rounded-xl border bg-background text-foreground transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:border-transparent ${
            hasError
              ? 'border-[var(--destructive)] text-[var(--destructive-text)] ring-1 ring-[var(--destructive)]'
              : focusedIndex === i
              ? 'border-[var(--primary)] ring-1 ring-[var(--primary)]'
              : digit
              ? 'border-foreground/30 bg-secondary/30'
              : 'border-border hover:border-input-border'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        />
      ))}
    </div>
  );
}
