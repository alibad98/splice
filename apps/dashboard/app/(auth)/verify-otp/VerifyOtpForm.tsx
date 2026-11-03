'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, cn, Field, Icon, OtpInput } from '@slips/ui';
import { AuthAlert } from '../../../components/auth/AuthAlert';
import { AuthHeading, authLinkClass } from '../../../components/auth/AuthHeading';
import { useI18n } from '../../../i18n/provider';
import { authClient } from '../../../lib/auth/client';

const COUNTDOWN_SECONDS = 60;
const CODE_LENGTH = 6;

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
  const [codeError, setCodeError] = useState<string | undefined>();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(() => setSecondsLeft((prev) => Math.max(0, prev - 1)), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const verifyCode = async (code: string) => {
    if (!email || isPending) return;
    if (code.length !== CODE_LENGTH) {
      setCodeError(m.errors.codeIncomplete);
      return;
    }

    setIsPending(true);
    setErrorMessage(null);
    setCodeError(undefined);

    const result = await authClient.verifyOtp({ email, code, purpose: flow });
    if (result.ok) {
      const next = flow === 'setup' ? '/set-password' : '/reset-password';
      router.push(`${next}?email=${encodeURIComponent(email)}&token=${encodeURIComponent(result.data.token)}`);
      return;
    }

    setIsPending(false);
    const err = result.error.code;
    if (err === 'invalid_otp') {
      // The code itself is wrong: show it on the field and let the user retype from the start.
      setCodeError(m.errors.invalidOtp);
      setOtp('');
    } else {
      setErrorMessage(
        err === 'otp_expired' ? m.errors.otpExpired : err === 'otp_attempts_exceeded' ? m.errors.otpAttemptsExceeded : err === 'network_error' ? m.errors.networkError : m.errors.genericError,
      );
    }
  };

  const handleResend = async () => {
    if (!email || secondsLeft > 0 || isResending) return;
    setIsResending(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    const result = await authClient.resendOtp({ email, purpose: flow });
    setIsResending(false);
    if (result.ok) {
      setSecondsLeft(COUNTDOWN_SECONDS);
      setSuccessMessage(m.success.otpSent);
      setOtp('');
      setCodeError(undefined);
    } else {
      setErrorMessage(m.errors.genericError);
    }
  };

  const timer = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;

  return (
    <div className="flex flex-col gap-[clamp(16px,3dvh,24px)]">
      <AuthHeading title={m.verifyOtpTitle}>
        {m.verifyOtpSubtitle}{' '}
        <bdi dir="ltr" className="font-semibold break-all text-foreground">
          {email}
        </bdi>
      </AuthHeading>

      {successMessage && <AuthAlert type="success" message={successMessage} onDismiss={() => setSuccessMessage(null)} />}
      {errorMessage && <AuthAlert type="error" message={errorMessage} onDismiss={() => setErrorMessage(null)} />}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void verifyCode(otp);
        }}
        className="flex flex-col gap-5"
        noValidate
      >
        <Field label={m.otpLabel} error={codeError} className="items-center [&>div:first-child]:self-start">
          <OtpInput
            length={CODE_LENGTH}
            value={otp}
            autoFocus
            digitLabel={m.otpDigit}
            ofLabel={m.otpOf}
            onChange={(val) => {
              setOtp(val);
              if (codeError) setCodeError(undefined);
              if (errorMessage) setErrorMessage(null);
            }}
            onComplete={(code) => void verifyCode(code)}
            disabled={isPending}
            hasError={Boolean(codeError)}
          />
        </Field>

        <div className="flex min-h-9 items-center justify-between gap-3 text-small">
          {secondsLeft > 0 ? (
            <span className="text-muted-foreground">
              {m.resendCountdown}{' '}
              <span role="timer" className="font-bold text-foreground tabular-nums" dir="ltr">
                {timer}
              </span>
            </span>
          ) : (
            <Button variant="ghost" size="sm" pending={isResending} onClick={handleResend} className="-ms-3 text-info-text">
              {m.resendCode}
            </Button>
          )}
          <Link href="/login" className={cn(authLinkClass, 'inline-flex items-center gap-1 text-muted-foreground hover:text-foreground')}>
            <Icon name="arrow" className="size-4 rotate-180" />
            {m.backToLogin}
          </Link>
        </div>

        <Button type="submit" variant="primary" size="lg" pending={isPending} className="w-full">
          {isPending ? m.verifyingButton : m.verifyButton}
        </Button>
      </form>
    </div>
  );
}
