'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { AuthAlert } from '../../../components/auth/AuthAlert';
import { FormInput } from '../../../components/auth/FormInput';
import type { StoreChoice } from '@slips/contracts';
import { SallaButton } from '../../../components/auth/SallaButton';
import { StorePicker } from '../../../components/auth/StorePicker';
import { useI18n } from '../../../i18n/provider';
import { authClient } from '../../../lib/auth/client';

interface LoginFormProps {
  resetSuccess?: boolean;
}

export function LoginForm({ resetSuccess }: LoginFormProps) {
  const { messages } = useI18n();
  const m = messages.auth;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [choice, setChoice] = useState<{ selection_token: string; stores: StoreChoice[] } | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password || isPending) return;

    setIsPending(true);
    setErrorMessage(null);

    const result = await authClient.login({ email: email.trim(), password });
    if (result.ok) {
      if ('select_store' in result.data) {
        setChoice(result.data.select_store);
        return;
      }
      window.location.href = '/';
      return;
    }

    setIsPending(false);
    if (result.error.code === 'invalid_credentials') {
      setErrorMessage(m.errors.invalidCredentials);
    } else if (result.error.code === 'store_inactive') {
      setErrorMessage(m.errors.storeInactive);
    } else if (result.error.code === 'network_error') {
      setErrorMessage(m.errors.networkError);
    } else {
      setErrorMessage(m.errors.genericError);
    }
  };

  if (choice) return <StorePicker selectionToken={choice.selection_token} stores={choice.stores} />;

  return (
    <div className="space-y-6">
      <div className="space-y-1.5 text-start">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">{m.loginTitle}</h2>
        <p className="text-sm text-muted-foreground">{m.loginSubtitle}</p>
      </div>

      {resetSuccess && (
        <AuthAlert type="success" message={m.success.passwordReset} />
      )}

      {errorMessage && (
        <AuthAlert type="error" message={errorMessage} onDismiss={() => setErrorMessage(null)} />
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <FormInput
          label={m.emailLabel}
          type="email"
          autoComplete="email"
          placeholder={m.emailPlaceholder}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <div className="space-y-1.5">
          <FormInput
            label={m.passwordLabel}
            type="password"
            autoComplete="current-password"
            placeholder={m.passwordPlaceholder}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <div className="flex justify-end">
            <Link
              href="/forgot-password"
              className="text-xs font-semibold text-[var(--primary)] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
            >
              {m.forgotPasswordLink}
            </Link>
          </div>
        </div>

        <button
          type="submit"
          disabled={isPending || !email || !password}
          className="w-full h-11 inline-flex items-center justify-center rounded-xl bg-[var(--primary)] text-white font-semibold text-sm hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
        >
          {isPending ? m.signingInButton : m.signInButton}
        </button>
      </form>

      {/* Salla Registration Redirection */}
      <div className="relative flex items-center justify-center my-6">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative bg-card px-3">
          <span className="text-xs text-muted-foreground font-medium">
            {m.noAccount}
          </span>
        </div>
      </div>

      {/* Salla Register Button (opens salla.sa/auth/register) */}
      <SallaButton />
    </div>
  );
}
