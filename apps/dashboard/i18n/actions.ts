'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { isLocale, localeCookie } from './config';

export async function setLocale(formData: FormData): Promise<void> {
  const next = formData.get('locale');
  if (!isLocale(next)) return;
  const store = await cookies();
  store.set(localeCookie, next, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  revalidatePath('/', 'layout');
}
