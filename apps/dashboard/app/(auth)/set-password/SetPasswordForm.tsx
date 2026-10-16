'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthAlert } from '../../../components/auth/AuthAlert';
import type { StoreChoice } from '@slips/contracts';
import { FormInput } from '../../../components/auth/FormInput';
import { StorePicker } from '../../../components/auth/StorePicker';
import { useI18n } from '../../../i18n/provider';
import { authClient } from '../../../lib/auth/client';

export function SetPasswordForm() {
  const { messages } = useI18n();
  const m = messages.auth;
  const searchParams = useSearchParams();

  const email = searchParams.get('email') ?? '';
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [choice, setChoice] = useState<{ selection_token: string; stores: StoreChoice[] } | null>(null);

  if (choice) return <StorePicker selectionToken={choice.selection_token} stores={choice.stores} />;

  if (!email || !token) {
    return (
      <div className="space-y-4 text-center py-4">
        <AuthAlert type="error" message={m.errors.invalidToken} />
        <Link
          href="/login"
          className="inline-flex h-10 items-center justify-center rounded-xl bg-[var(--primary)] px-5 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
        >
          {m.backToLogin}
        </Link>
      </div>
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || !confirmPassword || isPending) return;

    if (password.length < 8) {
      setErrorMessage(m.passwordRequirements);
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage(m.passwordMismatch);
      return;
    }

    setIsPending(true);
    setErrorMessage(null);

    const result = await authClient.setPassword({
      setup_token: token,
      new_password: password,
    });

    if (result.ok) {
      if ('select_store' in result.data) {
        setChoice(result.data.select_store);
        return;
      }
      window.location.href = '/';
      return;
    }

    setIsPending(false);
    if (result.error.code === 'invalid_token') {
      setErrorMessage(m.errors.invalidToken);
    } else if (result.error.code === 'store_inactive') {
      setErrorMessage(m.errors.storeInactive);
    } else if (result.error.code === 'network_error') {
      setErrorMessage(m.errors.networkError);
    } else {
      setErrorMessage(m.errors.genericError);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1.5 text-start">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">{m.setPasswordTitle}</h2>
        <p className="text-sm text-muted-foreground">{m.setPasswordSubtitle}</p>
      </div>

      {errorMessage && (
        <AuthAlert type="error" message={errorMessage} onDismiss={() => setErrorMessage(null)} />
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <FormInput
          label={m.newPasswordLabel}
          type="password"
          autoComplete="new-password"
          placeholder={m.passwordPlaceholder}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          helperText={m.passwordRequirements}
          required
        />

        <FormInput
          label={m.confirmPasswordLabel}
          type="password"
          autoComplete="new-password"
          placeholder={m.passwordPlaceholder}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
        />

        <button
          type="submit"
          disabled={isPending || !password || !confirmPassword}
          className="w-full h-11 inline-flex items-center justify-center rounded-xl bg-[var(--primary)] text-white font-semibold text-sm hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 mt-2"
        >
          {isPending ? m.settingPasswordButton : m.setPasswordButton}
        </button>
      </form>

      <div className="text-center pt-2">
        <Link
          href="/login"
          className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
        >
          {m.backToLogin}
        </Link>
      </div>
    </div>
  );
}
