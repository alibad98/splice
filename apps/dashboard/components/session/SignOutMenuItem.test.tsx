// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { dialog, DialogHost, SidebarMenu, SidebarProvider } from '@slips/ui';
import { SignOutMenuItem } from './SessionActions';
import { SessionProvider } from './SessionProvider';
import { SessionClient } from '../../lib/session/session-client';
import { I18nProvider } from '../../i18n/provider';
import { getMessages } from '../../i18n/messages';

afterEach(() => {
  act(() => dialog.clear());
  cleanup();
});

const m = getMessages('en').session;
const info = { v: 1 as const, mode: 'direct' as const, store: { name: 'Demo Store', domains: [] }, connection: { v: 1 as const, state: 'connected' as const, store_name: 'Demo Store' }, expires_at: '2030-01-01T00:00:00.000Z', csrf_token: 'c' };

const setup = () => {
  const signOut = vi.spyOn(SessionClient.prototype, 'signOut').mockResolvedValue(undefined);
  render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <SessionProvider apiBase="https://api.example.com" signInHref="https://api.example.com/install" initial={{ kind: 'signed-in', info }} framed={false}>
        <SidebarProvider>
          <SidebarMenu>
            <SignOutMenuItem />
          </SidebarMenu>
        </SidebarProvider>
        <DialogHost />
      </SessionProvider>
    </I18nProvider>,
  );
  return signOut;
};

describe('SignOutMenuItem', () => {
  it('opens a confirm dialog without signing out; Cancel closes it with no call', async () => {
    const signOut = setup();
    fireEvent.click(screen.getByRole('button', { name: m.signOut }));
    await screen.findByRole('alertdialog');
    expect(signOut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: m.signOutCancel }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(signOut).not.toHaveBeenCalled();
  });

  it('confirming calls signOut exactly once', async () => {
    const signOut = setup();
    fireEvent.click(screen.getByRole('button', { name: m.signOut }));
    const dlg = await screen.findByRole('alertdialog');
    const confirm = Array.from(dlg.querySelectorAll('button')).find((b) => b.textContent === m.signOutConfirm)!;
    fireEvent.click(confirm);
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });
});
