'use client';

import type { ReactNode } from 'react';
import { Alert } from '@slips/ui';
import { useI18n } from '../../i18n/provider';

interface AuthAlertProps {
  type: 'error' | 'success';
  message: ReactNode;
  onDismiss?: () => void;
}

/** Form-level outcome for the auth pages, on the kit Alert (errors interrupt, success is polite). */
export function AuthAlert({ type, message, onDismiss }: AuthAlertProps) {
  const { messages } = useI18n();
  if (!message) return null;
  return <Alert tone={type === 'error' ? 'danger' : 'success'} title={message} onDismiss={onDismiss} dismissLabel={messages.auth.dismissAlert} className="animate-rise-in" />;
}
