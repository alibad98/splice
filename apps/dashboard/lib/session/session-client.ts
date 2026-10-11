import { EmbeddedSession, SessionInfo } from '@slips/contracts';
import type { EmbeddedHost } from '../embedded/host';
import { connectionFromStatus, type ShellConnection } from '../shell';

export type SignedOutReason = 'none' | 'expired' | 'signed-out';
export type SessionErrorCode = 'store_not_installed' | 'platform_unavailable' | 'invalid_token' | 'unknown';

export type SessionState =
  | { status: 'loading' }
  | { status: 'signed-in'; mode: 'embedded' | 'direct'; storeName: string; connection: ShellConnection; csrfToken?: string; openInPlatformUrl?: string }
  | { status: 'signed-out'; reason: SignedOutReason }
  | { status: 'error'; code: SessionErrorCode };

export interface SessionClientOptions {
  /** Browser-reachable API base URL. */
  apiBase: string;
  host: EmbeddedHost;
  fetch?: typeof fetch;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

const REFRESH_AT = 0.8;
const problemCode = async (res: Response): Promise<string | undefined> => ((await res.json().catch(() => null)) as { code?: string } | null)?.code;

export function stateFromInfo(info: SessionInfo): Extract<SessionState, { status: 'signed-in' }> {
  return {
    status: 'signed-in',
    mode: info.mode,
    storeName: info.store.name,
    connection: connectionFromStatus(info.connection),
    ...(info.csrf_token ? { csrfToken: info.csrf_token } : {}),
    ...(info.open_in_platform_url ? { openInPlatformUrl: info.open_in_platform_url } : {}),
  };
}

/**
 * Browser-side session (AD-12). Embedded: the host token is traded for a short-lived bearer kept in this object's
 * memory only (never storage, never a cookie) and re-minted from a fresh host token before it expires. Direct link:
 * the httpOnly cookie rides along (`credentials: include`) and the CSRF token goes on state-changing requests.
 */
export class SessionClient {
  private state: SessionState;
  private bearer: string | undefined;
  private timer: unknown;
  private readonly listeners = new Set<() => void>();
  private readonly fetchImpl: typeof fetch;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (id: unknown) => void;
  private minting: Promise<void> | undefined;

  constructor(private readonly options: SessionClientOptions, initial: SessionState) {
    this.state = initial;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  }

  isFramed = (): boolean => this.options.host.isFramed();

  getState = (): SessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(state: SessionState): void {
    this.state = state;
    for (const l of this.listeners) l();
  }

  private url(path: string): string {
    return `${this.options.apiBase.replace(/\/+$/, '')}${path}`;
  }

  /** Begin: framed pages sign in through the host token; a page that arrived with a cookie session needs nothing. */
  async start(): Promise<void> {
    if (this.state.status === 'signed-in') return;
    if (!this.options.host.isFramed()) {
      this.set({ status: 'signed-out', reason: this.state.status === 'signed-out' ? this.state.reason : 'none' });
      return;
    }
    this.set({ status: 'loading' });
    await this.options.host.init();
    await this.mint();
    if (this.getState().status === 'signed-in') this.options.host.ready();
  }

  stop(): void {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
  }

  /** Trade the host's current token for a bearer. Single-flight. */
  mint(): Promise<void> {
    this.minting ??= this.doMint().finally(() => {
      this.minting = undefined;
    });
    return this.minting;
  }

  private async doMint(): Promise<void> {
    const hostToken = this.options.host.getToken();
    if (!hostToken) return this.set({ status: 'error', code: 'invalid_token' });
    let res: Response;
    try {
      res = await this.fetchImpl(this.url('/v1/session/embedded'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: hostToken }), cache: 'no-store' });
    } catch {
      return this.keepOrFail('platform_unavailable');
    }
    if (!res.ok) {
      const code = await problemCode(res);
      if (code === 'invalid_token') {
        // The host token is stale: ask the host to re-render the page with a new one.
        this.options.host.refresh();
        return this.keepOrFail('invalid_token');
      }
      return this.keepOrFail(code === 'store_not_installed' ? 'store_not_installed' : code === 'platform_unavailable' ? 'platform_unavailable' : 'unknown', code === 'store_not_installed');
    }
    const parsed = EmbeddedSession.safeParse(await res.json().catch(() => null));
    if (!parsed.success) return this.keepOrFail('unknown');
    this.bearer = parsed.data.access_token;
    const info = await this.loadInfo();
    if (!info) return this.keepOrFail('unknown');
    this.set(stateFromInfo(info));
    this.stop();
    this.timer = this.setTimer(() => void this.mint(), Math.max(1000, parsed.data.expires_in * 1000 * REFRESH_AT));
  }

  /** A failed re-mint must not log out a merchant who still holds a valid bearer; a failed first mint (or a hard refusal) shows the error. */
  private keepOrFail(code: SessionErrorCode, hard = false): void {
    if (!hard && this.state.status === 'signed-in' && this.bearer) {
      this.stop();
      this.timer = this.setTimer(() => void this.mint(), 15_000);
      return;
    }
    this.bearer = undefined;
    this.set({ status: 'error', code });
  }

  private async loadInfo(): Promise<SessionInfo | undefined> {
    try {
      const res = await this.request('/v1/session', {}, false);
      if (!res.ok) return undefined;
      const parsed = SessionInfo.safeParse(await res.json());
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Call the API as the signed-in merchant. A 401 on an embedded bearer re-mints once and retries; a `session_expired`
   * answer on a cookie session returns the merchant to sign-in with friendly copy.
   */
  async apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    return this.request(path, init, true);
  }

  private async request(path: string, init: RequestInit, retry: boolean): Promise<Response> {
    const headers = new Headers(init.headers);
    const s = this.state;
    const method = (init.method ?? 'GET').toUpperCase();
    if (this.bearer) headers.set('authorization', `Bearer ${this.bearer}`);
    else if (s.status === 'signed-in' && s.csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('x-csrf-token', s.csrfToken);
    const res = await this.fetchImpl(this.url(path), { ...init, headers, credentials: this.bearer ? 'omit' : 'include', cache: 'no-store' });
    if (res.status !== 401) return res;
    const code = await problemCode(res.clone());
    if (this.bearer && retry) {
      await this.mint();
      return this.request(path, init, false);
    }
    if (!this.bearer && s.status === 'signed-in') this.set({ status: 'signed-out', reason: code === 'session_expired' ? 'expired' : 'none' });
    return res;
  }

  /** End the session immediately, in either mode. */
  async signOut(): Promise<void> {
    try {
      await this.request('/v1/session/sign-out', { method: 'POST' }, false);
    } finally {
      this.stop();
      this.bearer = undefined;
      this.set({ status: 'signed-out', reason: 'signed-out' });
    }
  }
}
