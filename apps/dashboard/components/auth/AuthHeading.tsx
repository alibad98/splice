import type { ReactNode } from 'react';

/** Title + intro for an auth step. The page's single h1 lives on the brand panel (desktop), so steps use h2. */
export function AuthHeading({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 text-start">
      <h2 className="text-h1 text-balance text-foreground">{title}</h2>
      {children ? <p className="text-body text-pretty text-muted-foreground">{children}</p> : null}
    </div>
  );
}

/** Inline text link on auth pages: AA coral text, underline on hover, global focus outline. */
export const authLinkClass = 'rounded-sm font-semibold text-info-text underline-offset-4 transition-colors hover:underline';

/** Simple shape check; the server stays the authority. */
export const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
