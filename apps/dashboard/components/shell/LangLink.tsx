'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { ComponentProps } from 'react';
import { isLocale, withLang } from '../../i18n/config';

/** Link that carries the current ?lang so the language survives navigation inside the iframe. */
export function LangLink({ href, ...rest }: Omit<ComponentProps<typeof Link>, 'href'> & { href: string }) {
  const raw = useSearchParams().get('lang');
  return <Link href={withLang(href, isLocale(raw) ? raw : null)} {...rest} />;
}
