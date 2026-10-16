'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthAlert } from '../../../components/auth/AuthAlert';
import { FormInput } from '../../../components/auth/FormInput';
import { useI18n } from '../../../i18n/provider';
import { authClient } from '../../../lib/auth/client';

export default function ForgotPasswordPage() {
  const { messages } = useI18n();
  const m = messages.auth;
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || isPending) return;

    setIsPending(true);
    setErrorMessage(null);

    const cleanEmail = email.trim();
    const result = await authClient.forgotPassword({ email: cleanEmail });

    if (result.ok) {
      router.push(`/verify-otp?flow=reset&email=${encodeURIComponent(cleanEmail)}`);
      return;
    }

    setIsPending(false);
    if (result.error.code === 'network_error') {
      setErrorMessage(m.errors.networkError);
    } else {
      setErrorMessage(m.errors.genericError);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1.5 text-start">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">{m.forgotPasswordTitle}</h2>
        <p className="text-sm text-muted-foreground">{m.forgotPasswordSubtitle}</p>
      </div>

      {errorMessage && (
        <AuthAlert type="error" message={errorMessage} onDismiss={() => setErrorMessage(null)} />
      )}

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <FormInput
          label={m.emailLabel}
          type="email"
          autoComplete="email"
          placeholder={m.emailPlaceholder}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <button
          type="submit"
          disabled={isPending || !email}
          className="w-full h-11 inline-flex items-center justify-center rounded-xl bg-[var(--primary)] text-white font-semibold text-sm hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
        >
          {isPending ? m.sendingOtpButton : m.sendOtpButton}
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
