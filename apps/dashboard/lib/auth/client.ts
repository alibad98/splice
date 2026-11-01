import type {
  ForgotPasswordInput,
  LoginInput,
  ResendOtpInput,
  ResetPasswordInput,
  SelectStoreInput,
  SetPasswordInput,
  SignInResponse,
  VerifyOtpInput,
  VerifyOtpResponse,
} from '@slips/contracts';

export interface AuthApiError {
  code: string;
  message: string;
}

export type AuthResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AuthApiError };

async function postJson<T>(endpoint: string, payload: unknown): Promise<AuthResult<T>> {
  try {
    const res = await fetch(`/api/auth/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: {
          code: (data as { code?: string })?.code ?? `http_${res.status}`,
          message: (data as { message?: string })?.message ?? 'Request failed',
        },
      };
    }
    return { ok: true, data: data as T };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'network_error',
        message: err instanceof Error ? err.message : 'Network connection failed',
      },
    };
  }
}

export const authClient = {
  login: (input: LoginInput) =>
    postJson<SignInResponse>('login', input),

  selectStore: (input: SelectStoreInput) =>
    postJson<SignInResponse>('login/select', input),

  forgotPassword: (input: ForgotPasswordInput) =>
    postJson<{ ok: boolean }>('forgot-password', input),

  verifyOtp: (input: VerifyOtpInput) =>
    postJson<VerifyOtpResponse>('verify-otp', input),

  resetPassword: (input: ResetPasswordInput) =>
    postJson<{ ok: boolean }>('reset-password', input),

  setPassword: (input: SetPasswordInput) =>
    postJson<SignInResponse>('set-password', input),

  resendOtp: (input: ResendOtpInput) =>
    postJson<{ ok: boolean }>('resend-otp', input),
};
