import { cookies, headers } from 'next/headers';
import { langHeader, localeCookie, pickLocale } from './config';
import type { Locale } from './config';

export async function getLocale(): Promise<Locale> {
  const [h, c] = await Promise.all([headers(), cookies()]);
  return pickLocale(h.get(langHeader), c.get(localeCookie)?.value);
}
