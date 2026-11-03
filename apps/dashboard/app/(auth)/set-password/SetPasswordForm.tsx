'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import type { StoreChoice } from '@slips/contracts';
import { InvalidLinkNotice, NewPasswordForm } from '../../../components/auth/NewPasswordForm';
import { StorePicker } from '../../../components/auth/StorePicker';
import { useI18n } from '../../../i18n/provider';
import { authClient } from '../../../lib/auth/client';

export function SetPasswordForm() {
  const { messages } = useI18n();
  const m = messages.auth;
  const searchParams = useSearchParams();
  const email = searchParams.get('email') ?? '';
  const token = searchParams.get('token') ?? '';
  const [choice, setChoice] = useState<{ selection_token: string; stores: StoreChoice[] } | null>(null);

  if (choice) return <StorePicker selectionToken={choice.selection_token} stores={choice.stores} />;
  if (!email || !token) return <InvalidLinkNotice message={m.errors.invalidToken} actionHref="/login" actionLabel={m.backToLogin} />;

  return (
    <NewPasswordForm
      title={m.setPasswordTitle}
      subtitle={m.setPasswordSubtitle}
      submitLabel={m.setPasswordButton}
      onSubmit={async (password) => {
        const result = await authClient.setPassword({ setup_token: token, new_password: password });
        if (result.ok) {
          if ('select_store' in result.data) setChoice(result.data.select_store);
          else window.location.href = '/';
          return null;
        }
        const code = result.error.code;
        return code === 'invalid_token' ? m.errors.invalidToken : code === 'store_inactive' ? m.errors.storeInactive : code === 'network_error' ? m.errors.networkError : m.errors.genericError;
      }}
    />
  );
}
