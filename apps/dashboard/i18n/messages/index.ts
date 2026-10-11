import type { Locale } from '../config';
import { ar } from './ar';
import { en } from './en';
import type { Messages } from './en';

export type { Messages };
export const catalogs: Record<Locale, Messages> = { ar, en };
export function getMessages(locale: Locale): Messages {
  return catalogs[locale];
}
