import type { ReactNode } from 'react';

/**
 * Directional icons (arrows, chevrons) mirror in RTL; media/playback icons never do.
 * Everything else is symmetric and is left alone.
 */
const icons = {
  overview: { mirror: false, path: <path d="M3 11.5 12 4l9 7.5M5.5 10v9h13v-9" /> },
  content: { mirror: false, path: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10 9.5v5l4.5-2.5z" /></> },
  products: { mirror: false, path: <path d="M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8" /> },
  analytics: { mirror: false, path: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /> },
  settings: { mirror: false, path: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></> },
  menu: { mirror: false, path: <path d="M4 7h16M4 12h16M4 17h16" /> },
  close: { mirror: false, path: <path d="M6 6l12 12M18 6 6 18" /> },
  chevron: { mirror: true, path: <path d="M9 6l6 6-6 6" /> },
  arrow: { mirror: true, path: <path d="M5 12h14M13 6l6 6-6 6" /> },
  external: { mirror: true, path: <path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5" /> },
  help: { mirror: false, path: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01" /></> },
  play: { mirror: false, path: <path d="M8 5v14l11-7z" /> },
  pause: { mirror: false, path: <path d="M8 5v14M16 5v14" /> },
} satisfies Record<string, { mirror: boolean; path: ReactNode }>;

export type IconName = keyof typeof icons;
export const iconMirrors = (name: IconName): boolean => icons[name].mirror;

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  const { mirror, path } = icons[name];
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${mirror ? 'rtl:-scale-x-100' : ''} ${className}`.trim()}
    >
      {path}
    </svg>
  );
}
