'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useI18n } from '../../i18n/provider';
import { useSession } from './SessionProvider';

const card = 'mx-auto flex max-w-lg flex-col gap-4 rounded-lg border border-border bg-card p-6';
const primary = 'inline-flex min-h-11 items-center justify-center rounded-pill bg-primary px-6 font-semibold text-primary-foreground';
const secondary = 'inline-flex min-h-11 items-center justify-center rounded-pill border border-border bg-secondary/50 px-6 font-semibold text-foreground hover:bg-secondary';

/** Shows the page when signed in; otherwise loading, sign-in (with friendly copy when the session ended) or the reason sign-in failed. */
export function SessionGate({ children }: { children: ReactNode }) {
  const session = useSession();
  const { messages } = useI18n();
  if (!session) return <>{children}</>;
  const m = messages.session;
  const { state, signInHref } = session;

  if (state.status === 'signed-in') return <>{children}</>;
  if (state.status === 'loading') {
    return (
      <p role="status" className="text-body text-muted-foreground">
        {m.signingIn}
      </p>
    );
  }
  if (state.status === 'error') {
    const text = state.code === 'store_not_installed' ? m.notInstalled : state.code === 'platform_unavailable' ? m.platformUnavailable : state.code === 'invalid_token' ? m.invalidToken : m.unknownError;
    return (
      <section className={card} role="alert" data-testid="session-error">
        <h1 className="text-h2">{m.errorTitle}</h1>
        <p className="text-body text-muted-foreground">{text}</p>
        {state.code === 'store_not_installed' ? null : (
          <button type="button" className={primary} onClick={() => void session.client.start()}>
            {m.retry}
          </button>
        )}
      </section>
    );
  }
  const embedded = session.client.isFramed();
  const body = state.reason === 'expired' ? m.expired : state.reason === 'signed-out' ? m.signedOut : m.signInIntro;
  return (
    <section className={card} data-testid="sign-in">
      <h1 className="text-h2">{state.reason === 'expired' ? m.expiredTitle : m.signInTitle}</h1>
      <p className="text-body text-muted-foreground">{body}</p>
      {embedded ? (
        <button type="button" className={primary} onClick={() => void session.client.start()}>
          {m.signInAgain}
        </button>
      ) : (
        <div className="flex flex-col sm:flex-row gap-3">
          <Link href="/login" className={primary}>
            {m.signInAgain}
          </Link>
          <a href={signInHref} className={secondary}>
            {m.signInWithSalla}
          </a>
        </div>
      )}
    </section>
  );
}
