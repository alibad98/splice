// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SessionProvider, useSession } from './SessionProvider';

const info = {
  v: 1 as const, mode: 'direct' as const, store: { name: 'Demo', domains: [] },
  connection: { v: 1 as const, state: 'connected' as const, store_name: 'Demo' },
  expires_at: '2030-01-01T00:00:00.000Z', csrf_token: 'csrf',
};
function Connection() {
  const session = useSession();
  return <p>{session?.state.status === 'signed-in' ? JSON.stringify(session.state) : 'signed-out'}</p>;
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('refreshes the mounted session on focus and periodically, then removes listeners and timers', async () => {
  vi.useFakeTimers();
  let disconnected = true;
  const fetcher = vi.fn(async () => Response.json({ ...info, connection: { ...info.connection, state: disconnected ? 'disconnected' : 'connected' } }));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<SessionProvider apiBase="https://api.example.com" signInHref="/sign-in" initial={{ kind: 'signed-in', info }} framed={false}><Connection /></SessionProvider>);
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(screen.getByText(/"state":"disconnected"/)).toBeTruthy();
  disconnected = false;
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(screen.getByText(/"state":"connected"/)).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(2);
  view.unmount();
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
