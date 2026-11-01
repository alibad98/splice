'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthAlert } from '../../../components/auth/AuthAlert';
import { OtpInput } from '../../../components/auth/OtpInput';
import { useI18n } from '../../../i18n/provider';
import { authClient } from '../../../lib/auth/client';

const COUNTDOWN_SECONDS = 60;

export function VerifyOtpForm() {
  const { messages } = useI18n();
  const m = messages.auth;
  const router = useRouter();
  const searchParams = useSearchParams();

  const flow = searchParams.get('flow') === 'setup' ? 'setup' : 'reset';
  const email = searchParams.get('email') ?? '';

  const [otp, setOtp] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Countdown timer effect
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(() => {
      setSecondsLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const verifyCode = async (codeToVerify: string) => {
    if (!email || codeToVerify.length !== 6 || isPending) return;

    setIsPending(true);
    setErrorMessage(null);

    const purpose = flow === 'setup' ? ('setup' as const) : ('reset' as const);
    const result = await authClient.verifyOtp({
      email,
      code: codeToVerify,
      purpose,
    });

    if (result.ok) {
      const token = result.data.token;
      if (flow === 'setup') {
        router.push(`/set-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`);
      } else {
        router.push(`/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`);
      }
      return;
    }

    setIsPending(false);
    const code = result.error.code;
    if (code === 'otp_expired') {
      setErrorMessage(m.errors.otpExpired);
    } else if (code === 'otp_attempts_exceeded') {
      setErrorMessage(m.errors.otpAttemptsExceeded);
    } else if (code === 'invalid_otp') {
      setErrorMessage(m.errors.invalidOtp);
    } else if (code === 'network_error') {
      setErrorMessage(m.errors.networkError);
    } else {
      setErrorMessage(m.errors.genericError);
    }
  };

  const handleResend = async () => {
    if (!email || secondsLeft > 0 || isResending) return;

    setIsResending(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const purpose = flow === 'setup' ? ('setup' as const) : ('reset' as const);
    const result = await authClient.resendOtp({ email, purpose });

    setIsResending(false);
    if (result.ok) {
      setSecondsLeft(COUNTDOWN_SECONDS);
      setSuccessMessage(m.success.otpSent);
      setOtp('');
    } else {
      setErrorMessage(m.errors.genericError);
    }
  };

  const formattedTimer = `00:${secondsLeft < 10 ? `0${secondsLeft}` : secondsLeft}`;

  return (
    <div className="space-y-6">
      <div className="space-y-1.5 text-start">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">{m.verifyOtpTitle}</h2>
        <p className="text-sm text-muted-foreground">
          {m.verifyOtpSubtitle} <span className="font-semibold text-foreground dir-ltr inline-block">{email}</span>
        </p>
      </div>

      {successMessage && (
        <AuthAlert type="success" message={successMessage} onDismiss={() => setSuccessMessage(null)} />
      )}

      {errorMessage && (
        <AuthAlert type="error" message={errorMessage} onDismiss={() => setErrorMessage(null)} />
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void verifyCode(otp);
        }}
        className="space-y-6"
        noValidate
      >
        <div className="py-2">
          <OtpInput
            value={otp}
            onChange={(val) => {
              setOtp(val);
              if (errorMessage) setErrorMessage(null);
            }}
            onComplete={(fullCode) => {
              void verifyCode(fullCode);
            }}
            disabled={isPending}
            hasError={Boolean(errorMessage)}
          />
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
          {secondsLeft > 0 ? (
            <span className="font-medium text-muted-foreground">
              {m.resendCountdown} <span className="font-bold text-foreground tabular-nums">{formattedTimer}</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={handleResend}
              disabled={isResending}
              className="font-semibold text-[var(--primary)] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] disabled:opacity-50"
            >
              {isResending ? '...' : m.resendCode}
            </button>
          )}

          <Link
            href="/login"
            className="font-semibold hover:text-foreground transition-colors hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
          >
            {m.backToLogin}
          </Link>
        </div>

        <button
          type="submit"
          disabled={isPending || otp.length !== 6}
          className="w-full h-11 inline-flex items-center justify-center rounded-xl bg-[var(--primary)] text-white font-semibold text-sm hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
        >
          {isPending ? m.verifyingButton : m.verifyButton}
        </button>
      </form>
    </div>
  );
}
