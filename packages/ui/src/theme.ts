// Theme constants, server-safe (no 'use client'): the root layout inlines THEME_INIT_SCRIPT in <head>.
export type ThemeMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'slips.theme';

/** Applies the saved theme before first paint. Without a saved choice the OS preference wins (CSS). */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='dark'||t==='light'){document.documentElement.classList.add(t)}}catch(e){}`;
