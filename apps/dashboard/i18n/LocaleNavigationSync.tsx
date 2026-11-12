'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { directionOf, isLocale, langParam } from './config';
import { useI18n } from './provider';

/** Query-only navigations reuse layouts. Refresh their server copy after the new URL has committed. */
export function LocaleNavigationSync() {
  const { locale } = useI18n();
  const requested = useSearchParams().get(langParam);
  const router = useRouter();

  useEffect(() => {
    if (isLocale(requested) && requested !== locale) router.refresh();
  }, [locale, requested, router]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = directionOf(locale);
  }, [locale]);

  return null;
}
