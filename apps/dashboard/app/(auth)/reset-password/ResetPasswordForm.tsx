'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthAlert } from '../../../components/auth/AuthAlert';
import { FormInput } from '../../../components/auth/FormInput';
import { useI18n } from '../../../i18n/provider';
import { authClient } from '../../../lib/auth/client';

export function ResetPasswordForm() {
  const { messages } = useI18n();
  const m = messages.auth;
  const router = useRouter();
  const searchParams = useSearchParams();

  const email = searchParams.get('email') ?? '';
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!email || !token) {
    return (
      <div className="space-y-4 text-center py-4">
        <AuthAlert type="error" message={m.errors.invalidToken} />
        <Link
          href="/forgot-password"
          className="inline-flex h-10 items-center justify-center rounded-xl bg-[var(--primary)] px-5 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
        >
          {m.forgotPasswordTitle}
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

    const result = await authClient.resetPassword({
      reset_token: token,
      new_password: password,
    });

    if (result.ok) {
      router.push('/login?reset=success');
      return;
    }

    setIsPending(false);
    if (result.error.code === 'invalid_token') {
      setErrorMessage(m.errors.invalidToken);
    } else if (result.error.code === 'network_error') {
      setErrorMessage(m.errors.networkError);
    } else {
      setErrorMessage(m.errors.genericError);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1.5 text-start">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">{m.resetPasswordTitle}</h2>
        <p className="text-sm text-muted-foreground">{m.resetPasswordSubtitle}</p>
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
          {isPending ? m.settingPasswordButton : m.resetPasswordButton}
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
