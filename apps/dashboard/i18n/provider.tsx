'use client';

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { Locale } from './config';
import type { Messages } from './messages';

interface I18n {
  locale: Locale;
  messages: Messages;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ locale, messages, children }: I18n & { children: ReactNode }) {
  return <I18nContext value={{ locale, messages }}>{children}</I18nContext>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
