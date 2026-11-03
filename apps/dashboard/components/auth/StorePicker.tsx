'use client';

import { useState } from 'react';
import type { StoreChoice } from '@slips/contracts';
import { Icon, Spinner } from '@slips/ui';
import { useI18n } from '../../i18n/provider';
import { authClient } from '../../lib/auth/client';
import { AuthAlert } from './AuthAlert';
import { AuthHeading } from './AuthHeading';

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
    <div className="flex flex-col gap-[clamp(16px,3dvh,24px)]">
      <AuthHeading title={m.chooseStoreTitle}>{m.chooseStoreSubtitle}</AuthHeading>

      {errorMessage && <AuthAlert type="error" message={errorMessage} onDismiss={() => setErrorMessage(null)} />}

      <ul className="flex flex-col gap-2">
        {stores.map((store) => {
          const busy = opening === store.id;
          return (
            <li key={store.id}>
              <button
                type="button"
                onClick={() => open(store.id)}
                aria-busy={busy || undefined}
                aria-disabled={(opening !== null && !busy) || undefined}
                className="group flex min-h-13 w-full items-center gap-3 rounded-md border border-border bg-card px-4 text-start text-body font-semibold text-foreground transition-colors duration-150 hover:border-foreground/30 hover:bg-muted aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-pill bg-primary-tint text-info-text">
                  <Icon name="store" className="size-4" />
                </span>
                <span className="min-w-0 flex-1 truncate">{store.name}</span>
                {busy ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-small text-muted-foreground">
                    <Spinner />
                    {m.openingStore}
                  </span>
                ) : (
                  <Icon name="chevron" className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
