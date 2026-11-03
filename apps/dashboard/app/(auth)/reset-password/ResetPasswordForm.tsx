'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { InvalidLinkNotice, NewPasswordForm } from '../../../components/auth/NewPasswordForm';
import { useI18n } from '../../../i18n/provider';
import { authClient } from '../../../lib/auth/client';

export function ResetPasswordForm() {
  const { messages } = useI18n();
  const m = messages.auth;
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') ?? '';
  const token = searchParams.get('token') ?? '';

  if (!email || !token) return <InvalidLinkNotice message={m.errors.invalidToken} actionHref="/forgot-password" actionLabel={m.forgotPasswordTitle} />;

  return (
    <NewPasswordForm
      title={m.resetPasswordTitle}
      subtitle={m.resetPasswordSubtitle}
      submitLabel={m.resetPasswordButton}
      onSubmit={async (password) => {
        const result = await authClient.resetPassword({ reset_token: token, new_password: password });
        if (result.ok) {
          router.push('/login?reset=success');
          return null;
        }
        const code = result.error.code;
        return code === 'invalid_token' ? m.errors.invalidToken : code === 'network_error' ? m.errors.networkError : m.errors.genericError;
      }}
    />
  );
}
