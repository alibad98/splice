'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import type { StoreChoice } from '@slips/contracts';
import { Button, Field, Input, PasswordInput } from '@slips/ui';
import { AuthAlert } from '../../../components/auth/AuthAlert';
import { AuthHeading, authLinkClass, looksLikeEmail } from '../../../components/auth/AuthHeading';
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
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [choice, setChoice] = useState<{ selection_token: string; stores: StoreChoice[] } | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isPending) return;

    const cleanEmail = email.trim();
    const errors = {
      email: !cleanEmail ? m.errors.emailRequired : !looksLikeEmail(cleanEmail) ? m.errors.emailInvalid : undefined,
      password: !password ? m.errors.passwordRequired : undefined,
    };
    setFieldErrors(errors);
    if (errors.email || errors.password) {
      (errors.email ? emailRef : passwordRef).current?.focus();
      return;
    }

    setIsPending(true);
    setErrorMessage(null);

    const result = await authClient.login({ email: cleanEmail, password });
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
      passwordRef.current?.select();
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
    <div className="flex flex-col gap-[clamp(16px,3dvh,24px)]">
      <AuthHeading title={m.loginTitle}>{m.loginSubtitle}</AuthHeading>

      {resetSuccess && <AuthAlert type="success" message={m.success.passwordReset} />}
      {errorMessage && <AuthAlert type="error" message={errorMessage} onDismiss={() => setErrorMessage(null)} />}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Field label={m.emailLabel} error={fieldErrors.email}>
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
              if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }));
            }}
            required
          />
        </Field>

        <Field
          label={m.passwordLabel}
          error={fieldErrors.password}
          labelAction={
            <Link href="/forgot-password" className={authLinkClass}>
              {m.forgotPasswordLink}
            </Link>
          }
        >
          <PasswordInput
            ref={passwordRef}
            size="lg"
            dir="ltr"
            autoComplete="current-password"
            leadingIcon="lock"
            showLabel={m.showPassword}
            hideLabel={m.hidePassword}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
            }}
            required
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" pending={isPending} className="mt-2 w-full">
          {isPending ? m.signingInButton : m.signInButton}
        </Button>
      </form>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-small font-medium text-muted-foreground">{m.noAccount}</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <SallaButton />
    </div>
  );
}
