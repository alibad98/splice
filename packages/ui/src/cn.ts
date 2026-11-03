import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// The design system's type scale (globals.css `--text-*`), so `text-small` is merged as a font size, not a colour.
const merge = extendTailwindMerge({ extend: { theme: { text: ['display', 'h1', 'h2', 'h3', 'body', 'body-lg', 'small', 'kpi', 'button-sm', 'button', 'button-lg'] } } });

/** Join class names and let later Tailwind classes win over earlier conflicting ones. */
export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
