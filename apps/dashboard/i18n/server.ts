import { cookies } from 'next/headers';
import { localeCookie, resolveLocale } from './config';
import type { Locale } from './config';

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return resolveLocale(store.get(localeCookie)?.value);
}
