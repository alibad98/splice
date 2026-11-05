import type { ReactNode } from 'react';
import { cn } from './cn.js';

/**
 * Directional icons (arrows, chevrons) mirror in RTL; media/playback icons never do.
 * Everything else is symmetric and is left alone.
 */
const icons = {
  overview: { mirror: false, path: <path d="M3 11.5 12 4l9 7.5M5.5 10v9h13v-9" /> },
  content: {
    mirror: false,
    path: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="M10 9.5v5l4.5-2.5z" />
      </>
    ),
  },
  products: { mirror: false, path: <path d="M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8" /> },
  analytics: { mirror: false, path: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /> },
  settings: {
    mirror: false,
    path: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
      </>
    ),
  },
  menu: { mirror: false, path: <path d="M4 7h16M4 12h16M4 17h16" /> },
  close: { mirror: false, path: <path d="M6 6l12 12M18 6 6 18" /> },
  chevron: { mirror: true, path: <path d="M9 6l6 6-6 6" /> },
  'chevron-down': { mirror: false, path: <path d="M6 9l6 6 6-6" /> },
  'chevron-up': { mirror: false, path: <path d="M18 15l-6-6-6 6" /> },
  arrow: { mirror: true, path: <path d="M5 12h14M13 6l6 6-6 6" /> },
  external: { mirror: true, path: <path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5" /> },
  help: {
    mirror: false,
    path: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01" />
      </>
    ),
  },
  play: { mirror: false, path: <path d="M8 5v14l11-7z" /> },
  pause: { mirror: false, path: <path d="M8 5v14M16 5v14" /> },
  check: { mirror: false, path: <path d="M5 12.5l4.5 4.5L19 7.5" /> },
  search: {
    mirror: false,
    path: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </>
    ),
  },
  info: {
    mirror: false,
    path: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </>
    ),
  },
  'check-circle': {
    mirror: false,
    path: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8.5 12.5 2.5 2.5 4.5-5" />
      </>
    ),
  },
  warning: {
    mirror: false,
    path: (
      <>
        <path d="M12 4 3 20h18L12 4z" />
        <path d="M12 10v4M12 17h.01" />
      </>
    ),
  },
  danger: {
    mirror: false,
    path: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16h.01" />
      </>
    ),
  },
  eye: {
    mirror: false,
    path: (
      <>
        <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
  'eye-off': {
    mirror: false,
    path: (
      <>
        <path d="M10.6 5.7A10.7 10.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a15.8 15.8 0 0 1-3.1 3.9M6.5 6.5C4.1 8.2 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.9 0 3.6-.6 5-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
      </>
    ),
  },
  sun: {
    mirror: false,
    path: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2.5M12 19.5V22M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77" />
      </>
    ),
  },
  moon: {
    mirror: false,
    path: <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />,
  },
  archive: {
    mirror: false,
    path: (
      <>
        <rect x="3" y="4" width="18" height="4" rx="1" />
        <path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4" />
      </>
    ),
  },
  store: {
    mirror: false,
    path: (
      <>
        <path d="M4 7l1.5-3h13L20 7v2a2.5 2.5 0 0 1-4 2 2.5 2.5 0 0 1-4 0 2.5 2.5 0 0 1-4 0 2.5 2.5 0 0 1-4-2V7z" />
        <path d="M5 11v9h14v-9M9 20v-5h6v5" />
      </>
    ),
  },
  mail: {
    mirror: false,
    path: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2.5" />
        <path d="m3.5 6.5 8.5 6 8.5-6" />
      </>
    ),
  },
  lock: {
    mirror: false,
    path: (
      <>
        <rect x="5" y="11" width="14" height="10" rx="2.5" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </>
    ),
  },
  // Door on the inline start, arrow leaving towards the inline end; mirrors in RTL.
  logout: { mirror: true, path: <path d="M10 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4M15 16l4-4-4-4M19 12H9" /> },
  // Media and slide actions (Story 3.6). Vertical moves and media marks never mirror.
  upload: { mirror: false, path: <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /> },
  image: {
    mirror: false,
    path: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <circle cx="9" cy="10" r="1.75" />
        <path d="m21 16-5-5-9 9" />
      </>
    ),
  },
  video: {
    mirror: false,
    path: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M10 9v6l5-3z" />
      </>
    ),
  },
  'arrow-up': { mirror: false, path: <path d="M12 19V5M6 11l6-6 6 6" /> },
  'arrow-down': { mirror: false, path: <path d="M12 5v14M6 13l6 6 6-6" /> },
  trash: { mirror: false, path: <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5" /> },
  grip: {
    mirror: false,
    path: (
      <>
        <circle cx="9" cy="6" r="1" />
        <circle cx="15" cy="6" r="1" />
        <circle cx="9" cy="12" r="1" />
        <circle cx="15" cy="12" r="1" />
        <circle cx="9" cy="18" r="1" />
        <circle cx="15" cy="18" r="1" />
      </>
    ),
  },
  retry: { mirror: false, path: <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4.5h-4.5" /> },
  // Panel with its rail on the inline start (the sidebar toggle).
  sidebar: {
    mirror: true,
    path: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M9.5 4v16" />
      </>
    ),
  },
} satisfies Record<string, { mirror: boolean; path: ReactNode }>;

export type IconName = keyof typeof icons;
export const iconMirrors = (name: IconName): boolean => icons[name].mirror;

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  const { mirror, path } = icons[name];
  return (
    <svg
      data-slot="icon"
      data-icon={name}
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
      className={cn('shrink-0', mirror && 'rtl:-scale-x-100', className)}
    >
      {path}
    </svg>
  );
}

