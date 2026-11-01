import { z } from 'zod';

export const LoginInput = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const ForgotPasswordInput = z.object({
  email: z.string().trim().email(),
});
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordInput>;

export const OtpPurpose = z.enum(['setup', 'reset']);
export type OtpPurpose = z.infer<typeof OtpPurpose>;

export const VerifyOtpInput = z.object({
  email: z.string().trim().email(),
  code: z.string().trim().regex(/^\d{6}$/, { message: 'Must be a 6-digit code' }),
  purpose: OtpPurpose,
});
export type VerifyOtpInput = z.infer<typeof VerifyOtpInput>;

export const ResetPasswordInput = z.object({
  reset_token: z.string().min(1),
  new_password: z.string().min(8).max(128),
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordInput>;

export const SetPasswordInput = z.object({
  setup_token: z.string().min(1),
  new_password: z.string().min(8).max(128),
});
export type SetPasswordInput = z.infer<typeof SetPasswordInput>;

export const ResendOtpInput = z.object({
  email: z.string().trim().email(),
  purpose: OtpPurpose,
});
export type ResendOtpInput = z.infer<typeof ResendOtpInput>;

export const VerifyOtpResponse = z.object({
  token: z.string(),
  expires_in: z.number().int().positive(),
  purpose: OtpPurpose,
});
export type VerifyOtpResponse = z.infer<typeof VerifyOtpResponse>;

/** An owner with several stores proves the password once, then picks the store to open. */
export const SelectStoreInput = z.object({
  selection_token: z.string().min(1),
  store_id: z.uuid(),
});
export type SelectStoreInput = z.infer<typeof SelectStoreInput>;

export const StoreChoice = z.object({ id: z.uuid(), name: z.string() });
export type StoreChoice = z.infer<typeof StoreChoice>;

/** Result of login / set-password / select-store: signed in, or a store must be chosen first. */
export const SignInResponse = z.union([
  z.object({ ok: z.literal(true), session: z.unknown() }),
  z.object({ ok: z.literal(true), select_store: z.object({ selection_token: z.string(), stores: z.array(StoreChoice).min(2) }) }),
]);
export type SignInResponse = z.infer<typeof SignInResponse>;

export const AUTH_PROBLEM_CODES = [
  'invalid_credentials',
  'account_locked',
  'invalid_otp',
  'otp_expired',
  'otp_attempts_exceeded',
  'invalid_token',
  'email_not_found',
  'store_inactive',
] as const;
export type AuthProblemCode = (typeof AUTH_PROBLEM_CODES)[number];
