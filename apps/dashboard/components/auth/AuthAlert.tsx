'use client';

import type { ReactNode } from 'react';
import { useI18n } from '../../i18n/provider';

interface AuthAlertProps {
  type: 'error' | 'success';
  message: ReactNode;
  onDismiss?: () => void;
}

export function AuthAlert({ type, message, onDismiss }: AuthAlertProps) {
  const { messages } = useI18n();
  if (!message) return null;

  const isError = type === 'error';
  return (
    <div
      role="alert"
      className={`relative flex items-start gap-3 rounded-xl p-3.5 text-sm transition-all ${
        isError
          ? 'bg-[var(--destructive-tint)] border border-[var(--destructive)]/25 text-[var(--destructive-text)]'
          : 'bg-[var(--success-tint)] border border-[var(--success)]/25 text-[var(--success-text)]'
      }`}
    >
      <span className="shrink-0 mt-0.5">
        {isError ? (
          <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
        ) : (
          <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </span>
      <div className="flex-1 font-medium leading-snug">{message}</div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 -me-1 -mt-1 p-1 opacity-70 hover:opacity-100 transition-opacity"
          aria-label={messages.auth.dismissAlert}
        >
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
