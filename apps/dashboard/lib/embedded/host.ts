// The only dashboard file that talks to the Salla Merchant Dashboard host (embedded SDK). Everything else uses the EmbeddedHost interface.

export interface EmbeddedHost {
  /** True when this page is framed (Salla embeds it); false for a direct visit. */
  isFramed(): boolean;
  /** Handshake with the host. Resolves when the host answered or after a short timeout. */
  init(): Promise<void>;
  /** The short-lived token the host put on the page URL, or null. Read fresh on every call. */
  getToken(): string | null;
  /** Ask the host to re-render this page with a fresh token. */
  refresh(): void;
  /** Tell the host the app is ready (after sign-in succeeded). */
  ready(): void;
}

const INIT_TIMEOUT_MS = 4000;

async function sdk() {
  return (await import('@salla.sa/embedded-sdk')).embedded;
}

/** Real host. Browser only: the SDK is imported lazily so server rendering never touches it. */
export const sallaHost: EmbeddedHost = {
  isFramed: () => typeof window !== 'undefined' && window.parent !== window,
  init: async () => {
    const embedded = await sdk();
    await Promise.race([embedded.init(), new Promise<void>((resolve) => setTimeout(resolve, INIT_TIMEOUT_MS))]).catch(() => undefined);
  },
  getToken: () => {
    // Read straight from the URL so a token re-issued by the host is picked up without reloading the SDK.
    try {
      return new URLSearchParams(window.location.search).get('token');
    } catch {
      return null;
    }
  },
  refresh: () => {
    void sdk().then((embedded) => embedded.auth.refresh());
  },
  ready: () => {
    void sdk().then((embedded) => embedded.ready());
  },
};
