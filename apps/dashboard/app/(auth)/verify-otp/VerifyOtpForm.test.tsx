// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VerifyOtpForm } from './VerifyOtpForm';
import { I18nProvider } from '../../../i18n/provider';
import { getMessages } from '../../../i18n/messages';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams('flow=reset&email=a%40b.com'),
}));
const verifyOtp = vi.fn();
vi.mock('../../../lib/auth/client', () => ({ authClient: { verifyOtp: (...a: unknown[]) => verifyOtp(...a), resendOtp: vi.fn() } }));

const m = getMessages('en').auth;
const slots = () => screen.getAllByRole('textbox') as HTMLInputElement[];

beforeEach(() => {
  verifyOtp.mockReset();
  push.mockReset();
  render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <VerifyOtpForm />
    </I18nProvider>,
  );
});
afterEach(cleanup);

describe('VerifyOtpForm', () => {
  it('invalid_otp shows the field error and clears the code', async () => {
    verifyOtp.mockResolvedValue({ ok: false, error: { code: 'invalid_otp', message: 'x' } });
    fireEvent.change(slots()[0]!, { target: { value: '123456' } });
    await screen.findByText(m.errors.invalidOtp);
    expect(verifyOtp).toHaveBeenCalledWith({ email: 'a@b.com', code: '123456', purpose: 'reset' });
    await waitFor(() => expect(slots().every((s) => s.value === '')).toBe(true));
  });

  it('another error code shows the alert, not a field error', async () => {
    verifyOtp.mockResolvedValue({ ok: false, error: { code: 'otp_expired', message: 'x' } });
    fireEvent.change(slots()[0]!, { target: { value: '123456' } });
    await screen.findByText(m.errors.otpExpired);
    expect(screen.queryByText(m.errors.invalidOtp)).toBeNull();
  });

  it('submitting an incomplete code shows the incomplete error without calling the client', () => {
    fireEvent.change(slots()[0]!, { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: m.verifyButton }));
    expect(screen.getByText(m.errors.codeIncomplete)).toBeTruthy();
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
