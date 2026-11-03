// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LoginForm } from './LoginForm';
import { I18nProvider } from '../../../i18n/provider';
import { getMessages } from '../../../i18n/messages';

const login = vi.fn();
vi.mock('../../../lib/auth/client', () => ({ authClient: { login: (...a: unknown[]) => login(...a) } }));

const m = getMessages('en').auth;

beforeEach(() => {
  login.mockReset();
  render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <LoginForm />
    </I18nProvider>,
  );
});
afterEach(cleanup);

const submit = () => fireEvent.click(screen.getByRole('button', { name: m.signInButton }));

describe('LoginForm', () => {
  it('an empty email shows the required error, focuses the field and does not call login', () => {
    submit();
    expect(screen.getByText(m.errors.emailRequired)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(m.emailLabel));
    expect(login).not.toHaveBeenCalled();
  });

  it('an invalid email shows the invalid error, focuses the field and does not call login', () => {
    const email = screen.getByLabelText(m.emailLabel);
    fireEvent.change(email, { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText(m.passwordLabel), { target: { value: 'secret123' } });
    submit();
    expect(screen.getByText(m.errors.emailInvalid)).toBeTruthy();
    expect(document.activeElement).toBe(email);
    expect(login).not.toHaveBeenCalled();
  });

  it('invalid_credentials shows the alert', async () => {
    login.mockResolvedValue({ ok: false, error: { code: 'invalid_credentials', message: 'x' } });
    fireEvent.change(screen.getByLabelText(m.emailLabel), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(m.passwordLabel), { target: { value: 'wrongpass' } });
    submit();
    await screen.findByText(m.errors.invalidCredentials);
    expect(login).toHaveBeenCalledWith({ email: 'a@b.com', password: 'wrongpass' });
  });
});
