'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { Button, cn, Field, Icon, Input } from '@slips/ui';
import { AuthAlert } from '../../../components/auth/AuthAlert';
import { AuthHeading, authLinkClass, looksLikeEmail } from '../../../components/auth/AuthHeading';
import { useI18n } from '../../../i18n/provider';
import { authClient } from '../../../lib/auth/client';

export default function ForgotPasswordPage() {
  const { messages } = useI18n();
  const m = messages.auth;
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | undefined>();
  const emailRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isPending) return;

    const cleanEmail = email.trim();
    const error = !cleanEmail ? m.errors.emailRequired : !looksLikeEmail(cleanEmail) ? m.errors.emailInvalid : undefined;
    setEmailError(error);
    if (error) {
      emailRef.current?.focus();
      return;
    }

    setIsPending(true);
    setErrorMessage(null);

    const result = await authClient.forgotPassword({ email: cleanEmail });
    if (result.ok) {
      router.push(`/verify-otp?flow=reset&email=${encodeURIComponent(cleanEmail)}`);
      return;
    }

    setIsPending(false);
    setErrorMessage(result.error.code === 'network_error' ? m.errors.networkError : m.errors.genericError);
  };

  return (
    <div className="flex flex-col gap-[clamp(16px,3dvh,24px)]">
      <AuthHeading title={m.forgotPasswordTitle}>{m.forgotPasswordSubtitle}</AuthHeading>

      {errorMessage && <AuthAlert type="error" message={errorMessage} onDismiss={() => setErrorMessage(null)} />}

      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <Field label={m.emailLabel} error={emailError}>
          <Input
            ref={emailRef}
            size="lg"
            type="email"
            inputMode="email"
            dir="ltr"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            leadingIcon="mail"
            placeholder={m.emailPlaceholder}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailError) setEmailError(undefined);
            }}
            required
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" pending={isPending} className="w-full">
          {isPending ? m.sendingOtpButton : m.sendOtpButton}
        </Button>
      </form>

      <Link href="/login" className={cn(authLinkClass, 'inline-flex items-center justify-center gap-1.5 self-center text-small text-muted-foreground hover:text-foreground')}>
        <Icon name="arrow" className="size-4 rotate-180" />
        {m.backToLogin}
      </Link>
    </div>
  );
}
