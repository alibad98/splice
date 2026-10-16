'use client';

import { useState } from 'react';
import type { StoreChoice } from '@slips/contracts';
import { useI18n } from '../../i18n/provider';
import { authClient } from '../../lib/auth/client';
import { AuthAlert } from './AuthAlert';

interface StorePickerProps {
  selectionToken: string;
  stores: StoreChoice[];
}

/** Second sign-in step for an owner of several stores: open the chosen one. */
export function StorePicker({ selectionToken, stores }: StorePickerProps) {
  const { messages } = useI18n();
  const m = messages.auth;
  const [opening, setOpening] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const open = async (storeId: string) => {
    if (opening) return;
    setOpening(storeId);
    setErrorMessage(null);
    const result = await authClient.selectStore({ selection_token: selectionToken, store_id: storeId });
    if (result.ok && 'session' in result.data) {
      window.location.href = '/';
      return;
    }
    setOpening(null);
    const code = result.ok ? 'generic' : result.error.code;
    setErrorMessage(
      code === 'invalid_token' ? m.errors.selectionExpired : code === 'store_inactive' ? m.errors.storeInactive : code === 'network_error' ? m.errors.networkError : m.errors.genericError,
    );
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1.5 text-start">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">{m.chooseStoreTitle}</h2>
        <p className="text-sm text-muted-foreground">{m.chooseStoreSubtitle}</p>
      </div>

      {errorMessage && <AuthAlert type="error" message={errorMessage} onDismiss={() => setErrorMessage(null)} />}

      <ul className="space-y-2">
        {stores.map((store) => (
          <li key={store.id}>
            <button
              type="button"
              onClick={() => open(store.id)}
              disabled={opening !== null}
              className="w-full min-h-11 inline-flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 text-start text-sm font-semibold text-foreground hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="truncate">{store.name}</span>
              {opening === store.id && <span className="shrink-0 text-xs text-muted-foreground">{m.openingStore}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
