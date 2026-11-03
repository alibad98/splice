'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { Button, cn, Field, Icon, PasswordInput } from '@slips/ui';
import { useI18n } from '../../i18n/provider';
import { AuthAlert } from './AuthAlert';
import { AuthHeading, authLinkClass } from './AuthHeading';

const MIN_LENGTH = 8;

interface Props {
  title: string;
  subtitle: string;
  submitLabel: string;
  /** Sends the new password; resolves to an error message, or null when the caller has moved on (redirect). */
  onSubmit: (password: string) => Promise<string | null>;
}

/** New password + confirmation, shared by set-password and reset-password. Errors sit on the field they belong to. */
export function NewPasswordForm({ title, subtitle, submitLabel, onSubmit }: Props) {
  const { messages } = useI18n();
  const m = messages.auth;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isPending) return;
    const next = {
      password: password.length < MIN_LENGTH ? m.passwordRequirements : undefined,
      confirm: !confirm || confirm !== password ? m.passwordMismatch : undefined,
    };
    setErrors(next);
    if (next.password || next.confirm) {
      (next.password ? passwordRef : confirmRef).current?.focus();
      return;
    }
    setIsPending(true);
    setErrorMessage(null);
    const error = await onSubmit(password);
    if (error) {
      setIsPending(false);
      setErrorMessage(error);
    }
  };

  return (
    <div className="flex flex-col gap-[clamp(16px,3dvh,24px)]">
      <AuthHeading title={title}>{subtitle}</AuthHeading>

      {errorMessage && <AuthAlert type="error" message={errorMessage} onDismiss={() => setErrorMessage(null)} />}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Field label={m.newPasswordLabel} error={errors.password} hint={m.passwordRequirements}>
          <PasswordInput
            ref={passwordRef}
            size="lg"
            dir="ltr"
            autoComplete="new-password"
            minLength={MIN_LENGTH}
            leadingIcon="lock"
            showLabel={m.showPassword}
            hideLabel={m.hidePassword}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (errors.password) setErrors((x) => ({ ...x, password: undefined }));
            }}
            required
          />
        </Field>

        <Field label={m.confirmPasswordLabel} error={errors.confirm}>
          <PasswordInput
            ref={confirmRef}
            size="lg"
            dir="ltr"
            autoComplete="new-password"
            leadingIcon="lock"
            showLabel={m.showPassword}
            hideLabel={m.hidePassword}
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              if (errors.confirm) setErrors((x) => ({ ...x, confirm: undefined }));
            }}
            required
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" pending={isPending} className="mt-2 w-full">
          {isPending ? m.settingPasswordButton : submitLabel}
        </Button>
      </form>

      <Link href="/login" className={cn(authLinkClass, 'inline-flex items-center justify-center gap-1.5 self-center text-small text-muted-foreground hover:text-foreground')}>
        <Icon name="arrow" className="size-4 rotate-180" />
        {m.backToLogin}
      </Link>
    </div>
  );
}

/** Shown when a set/reset link is missing its email or token. */
export function InvalidLinkNotice({ message, actionHref, actionLabel }: { message: string; actionHref: string; actionLabel: string }) {
  return (
    <div className="flex flex-col gap-4">
      <AuthAlert type="error" message={message} />
      <Link href={actionHref} className="inline-flex min-h-11 w-full items-center justify-center rounded-pill bg-primary px-5 text-body-lg font-semibold text-primary-foreground transition-[filter] duration-150 hover:brightness-108">
        {actionLabel}
      </Link>
    </div>
  );
}
