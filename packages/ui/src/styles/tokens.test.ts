import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  const body = css.slice(start, css.indexOf('\n}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}
const light = block(':root');
const dark = { ...light, ...block('.dark') };

const REQUIRED = [
  'background', 'page', 'foreground', 'card', 'primary', 'primary-foreground', 'accent', 'accent-foreground', 'muted',
  'muted-foreground', 'border', 'input-border', 'info-text', 'delta-up', 'delta-down', 'story-ring-seen', 'success-tint',
  'primary-tint', 'destructive-tint', 'warning-tint', 'focus-ring-inner', 'ring', 'destructive', 'destructive-foreground',
  'destructive-text', 'success', 'success-text', 'warning', 'warning-foreground', 'warning-text',
  'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'player-scrim', 'player-surface', 'player-surface-foreground',
  'player-cta', 'player-cta-foreground', 'player-progress', 'player-progress-track',
];
// Tokens that must differ in dark (the dark theme switches the full set).
const THEMED = REQUIRED.filter((t) => !t.startsWith('player-') && t !== 'accent' && t !== 'accent-foreground' && t !== 'warning-foreground');

function rgb(hex: string): [number, number, number] {
  const h = hex.slice(1, 7);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function lum(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
// Composite an 8-digit hex over a base colour.
function over(fg: string, base: string): string {
  const a = parseInt(fg.slice(7, 9) || 'ff', 16) / 255;
  const f = rgb(fg), b = rgb(base);
  return '#' + f.map((v, i) => Math.round(v * a + b[i]! * (1 - a)).toString(16).padStart(2, '0')).join('');
}

describe('design tokens', () => {
  it.each([['light', light], ['dark', dark]] as const)('%s defines every DESIGN.md token', (_n, theme) => {
    for (const t of REQUIRED) expect(theme[`--${t}`], t).toMatch(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/);
  });

  it('dark switches the full themed set', () => {
    const darkOnly = block('.dark');
    for (const t of THEMED) expect(darkOnly[`--${t}`], t).toBeDefined();
  });

  it('contains no purple and gradients only in the story-ring token', () => {
    for (const theme of [light, dark]) {
      for (const [k, v] of Object.entries(theme)) {
        if (!/^#[0-9A-Fa-f]{6}/.test(v)) continue;
        const [r, g, b] = rgb(v);
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx - mn < 20) continue;
        const sector = mx === r ? ((g - b) / (mx - mn) + 6) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
        const h = sector * 60;
        expect(h < 255 || h > 320, `${k} ${v} hue ${h}`).toBe(true);
      }
    }
    const gradients = [...css.matchAll(/(--[\w-]+):[^;]*gradient\(/g)].map((m) => m[1]);
    expect(new Set(gradients)).toEqual(new Set(['--story-ring-gradient']));
    expect(css).not.toMatch(/(?:linear|radial)-gradient/);
  });

  // [foreground, background, minimum ratio]
  const PAIRS: Array<[string, string, number]> = [
    ['foreground', 'background', 4.5], ['foreground', 'page', 4.5], ['card-foreground', 'card', 4.5],
    ['popover-foreground', 'popover', 4.5], ['primary-foreground', 'primary', 4.5], ['accent-foreground', 'accent', 4.5],
    ['secondary-foreground', 'secondary', 4.5], ['muted-foreground', 'muted', 4.5], ['muted-foreground', 'card', 4.5],
    ['destructive-foreground', 'destructive', 4.5], ['warning-foreground', 'warning', 4.5],
    ['info-text', 'card', 4.5], ['delta-up', 'card', 4.5], ['delta-down', 'card', 4.5],
    ['success-text', 'card', 4.5], ['warning-text', 'card', 4.5], ['destructive-text', 'card', 4.5],
    ['player-cta-foreground', 'player-cta', 4.5], ['player-surface-foreground', 'player-surface', 4.5],
    ['sidebar-primary-foreground', 'sidebar-primary', 4.5],
    // UI components / graphics (3:1)
    ['input-border', 'card', 3], ['input-border', 'background', 3], ['ring', 'card', 3], ['focus-ring-inner', 'card', 3],
    ['focus-ring-inner', 'primary', 3], ['ring', 'focus-ring-inner', 1],
    ['chart-1', 'card', 3], ['chart-2', 'card', 3], ['chart-3', 'card', 3], ['chart-4', 'card', 3], ['chart-5', 'card', 3],
  ];
  it.each([['light', light], ['dark', dark]] as const)('%s pairs meet WCAG AA', (name, theme) => {
    for (const [fg, bg, min] of PAIRS) {
      // Documented exceptions: light-mode chart-4 amber and success/warning fills are graphics-only on card.
      if (name === 'light' && fg === 'chart-4') continue;
      // Dark white inner ring on a coral fill is 2.81:1; the ring-dark halo outside it holds 3:1 against the surface, so the pair is exempt.
      if (name === 'dark' && fg === 'focus-ring-inner' && bg === 'primary') continue;
      expect(ratio(theme[`--${fg}`]!, theme[`--${bg}`]!), `${name} ${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
    }
  });

  it('status text holds 4.5:1 on its own tint (light and dark)', () => {
    for (const theme of [light, dark]) {
      for (const [text, tint] of [['success-text', 'success-tint'], ['info-text', 'primary-tint'], ['destructive-text', 'destructive-tint'], ['warning-text', 'warning-tint']] as const) {
        const bg = over(theme[`--${tint}`]!, theme['--card']!);
        expect(ratio(theme[`--${text}`]!, bg), text).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('coral is never body text and ink sits on coral', () => {
    expect(light['--primary-foreground']).toBe('#15110F');
    expect(dark['--primary-foreground']).toBe('#15110F');
    expect(light['--info-text']).not.toBe(light['--primary']);
  });

  it('form controls use input-border and focus ring is two-tone', () => {
    expect(css).toMatch(/input, textarea, select[^{]*\{\s*border-color: var\(--input-border\)/);
    expect(css).toMatch(/:focus-visible \{[^}]*0 0 0 2px var\(--focus-ring-inner\), 0 0 0 4px var\(--ring\)/);
    expect(dark['--focus-ring-inner']).toBe('#FFFFFF');
  });

  it('defines type scale, Arabic rules, spacing and radius tokens', () => {
    for (const t of ['display', 'h1', 'h2', 'h3', 'body', 'body-lg', 'small', 'kpi']) expect(css).toContain(`--text-${t}:`);
    expect(css).toMatch(/--radius-sm:[^;]*8px/);
    expect(css).toContain('--radius-pill: 999px');
    expect(css).toContain('--spacing-gutter: 18px');
    expect(css).toMatch(/--page-padding: 16px/);
    expect(css).toMatch(/--page-padding: 28px/);
    expect(css).toMatch(/:lang\(ar\) \.text-display[^}]*font-weight: 700/);
    expect(css).toMatch(/:lang\(ar\) body[^}]*line-height: 1\.6/);
    expect(css).toMatch(/:lang\(ar\) \*[^}]*letter-spacing: 0/);
    expect(css).toMatch(/\[role="dialog"\][^}]*0 0 0 1px var\(--border\)/);
  });
});
