'use client';
// ThemeToggle: animated light/dark switch. The icon morphs sun -> moon (a mask circle slides in to cut the crescent,
// rays spin away); the page changes with a circular reveal from the button (View Transitions API).
// The icon state comes from the `dark` CSS variant, not React state, so it is right on first paint and never
// animates on load. Under prefers-reduced-motion, or without View Transitions, the switch is instant.
// Pair with THEME_INIT_SCRIPT in <head> so a saved choice applies before paint (no flash).
import { useEffect, useId, useState, type ComponentProps, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { cn } from './cn.js';
import { THEME_STORAGE_KEY, type ThemeMode } from './theme.js';

function currentDocumentTheme(): ThemeMode {
  const root = document.documentElement;
  if (root.classList.contains('dark')) return 'dark';
  if (root.classList.contains('light')) return 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyDocumentTheme(next: ThemeMode) {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(next);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // storage unavailable (private mode): the choice lasts for this page only
  }
}

type ViewTransitionDocument = Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };

/** Switches theme, revealing the new one in a growing circle from (x, y) when motion is allowed. */
function switchTheme(next: ThemeMode, x: number, y: number, onApplied: () => void) {
  const doc = document as ViewTransitionDocument;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const apply = () => {
    applyDocumentTheme(next);
    flushSync(onApplied);
  };
  if (!doc.startViewTransition || reduce) {
    apply();
    return;
  }
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  doc
    .startViewTransition(apply)
    .ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    })
    .catch(() => undefined);
}

export interface ThemeToggleProps extends Omit<ComponentProps<'button'>, 'onChange'> {
  /** Called with the next theme after it is applied. */
  onThemeChange?: (next: ThemeMode) => void;
  /** Accessible name while dark is showing, e.g. "Switch to light theme" / "التبديل إلى الوضع الفاتح". */
  lightLabel: string;
  /** Accessible name while light is showing, e.g. "Switch to dark theme" / "التبديل إلى الوضع الداكن". */
  darkLabel: string;
  /** Show the action text beside the icon. */
  showLabel?: boolean;
}

export function ThemeToggle({ onThemeChange, lightLabel, darkLabel, showLabel = false, className, onClick, ...props }: ThemeToggleProps) {
  const [theme, setTheme] = useState<ThemeMode | null>(null);
  const maskId = `theme-mask-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  useEffect(() => {
    setTheme(currentDocumentTheme());
    // Follow the OS while no choice is saved, and other tabs when one is.
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const sync = () => setTheme(currentDocumentTheme());
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY || (e.newValue !== 'dark' && e.newValue !== 'light')) return;
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(e.newValue);
      sync();
    };
    media?.addEventListener('change', sync);
    window.addEventListener('storage', onStorage);
    return () => {
      media?.removeEventListener('change', sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const isDark = theme === 'dark';
  const label = isDark ? lightLabel : darkLabel;

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    const next: ThemeMode = currentDocumentTheme() === 'dark' ? 'light' : 'dark';
    const rect = e.currentTarget.getBoundingClientRect();
    // Keyboard clicks report (0, 0): start from the button's centre instead.
    const x = e.clientX || rect.left + rect.width / 2;
    const y = e.clientY || rect.top + rect.height / 2;
    switchTheme(next, x, y, () => setTheme(next));
    onThemeChange?.(next);
  };

  return (
    <button
      type="button"
      data-slot="theme-toggle"
      aria-label={showLabel ? undefined : label}
      onClick={handleClick}
      className={cn(
        'group inline-flex min-h-9 min-w-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-pill border border-input-border bg-transparent text-small font-semibold text-foreground transition-colors duration-150 ease-out select-none hover:bg-muted',
        showLabel && 'px-3',
        className,
      )}
      {...props}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="size-[18px] shrink-0 overflow-visible">
        <mask id={maskId}>
          <rect width="24" height="24" fill="white" />
          {/* The "bite": parked outside the sun in light, slides over it in dark to leave a crescent. */}
          <circle
            cx="17"
            cy="7"
            r="6.5"
            fill="black"
            className="[translate:9px_-9px] transition-[translate] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] dark:[translate:0_0]"
          />
        </mask>
        <circle
          cx="12"
          cy="12"
          r="5"
          fill="currentColor"
          mask={`url(#${maskId})`}
          className="origin-center transition-[scale] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] [transform-box:fill-box] dark:[scale:1.65]"
        />
        <g
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="origin-center transition-[rotate,scale,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] [transform-box:fill-box] dark:[rotate:90deg] dark:[scale:0.4] dark:opacity-0"
        >
          <path d="M12 1.5v2M12 20.5v2M1.5 12h2M20.5 12h2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M4.6 19.4 6 18M18 6l1.4-1.4" />
        </g>
      </svg>
      {showLabel ? <span suppressHydrationWarning>{label}</span> : null}
    </button>
  );
}
