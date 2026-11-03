// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NewPasswordForm } from './NewPasswordForm';
import { I18nProvider } from '../../i18n/provider';
import { getMessages } from '../../i18n/messages';

afterEach(cleanup);

const m = getMessages('en').auth;

const setup = (onSubmit = vi.fn<(p: string) => Promise<string | null>>().mockResolvedValue(null)) => {
  render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <NewPasswordForm title="Set it" subtitle="Pick one" submitLabel="Save password" onSubmit={onSubmit} />
    </I18nProvider>,
  );
  const password = screen.getByLabelText(m.newPasswordLabel) as HTMLInputElement;
  const confirm = screen.getByLabelText(m.confirmPasswordLabel) as HTMLInputElement;
  const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
  return { onSubmit, password, confirm, submit };
};

describe('NewPasswordForm', () => {
  it('a password under 8 characters shows the field error, focuses the field and does not submit', () => {
    const { onSubmit, password, confirm, submit } = setup();
    fireEvent.change(password, { target: { value: 'short' } });
    fireEvent.change(confirm, { target: { value: 'short' } });
    submit();
    expect(screen.getByText(m.passwordRequirements)).toBeTruthy(); // the error replaces the hint
    expect(password.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(password);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a mismatched confirmation shows the confirm error, focuses it and does not submit', () => {
    const { onSubmit, password, confirm, submit } = setup();
    fireEvent.change(password, { target: { value: 'longenough1' } });
    fireEvent.change(confirm, { target: { value: 'different12' } });
    submit();
    expect(screen.getByText(m.passwordMismatch)).toBeTruthy();
    expect(document.activeElement).toBe(confirm);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('valid input calls onSubmit once with the password', async () => {
    const { onSubmit, password, confirm, submit } = setup();
    fireEvent.change(password, { target: { value: 'longenough1' } });
    fireEvent.change(confirm, { target: { value: 'longenough1' } });
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith('longenough1');
    expect(screen.queryByText(m.passwordMismatch)).toBeNull();
  });

  it('an error string from onSubmit shows the alert and re-enables the button', async () => {
    const onSubmit = vi.fn<(p: string) => Promise<string | null>>().mockResolvedValue('Link expired');
    const { password, confirm, submit } = setup(onSubmit);
    fireEvent.change(password, { target: { value: 'longenough1' } });
    fireEvent.change(confirm, { target: { value: 'longenough1' } });
    submit();
    await screen.findByText('Link expired');
    const button = screen.getByRole('button', { name: 'Save password' });
    expect(button.getAttribute('aria-busy')).not.toBe('true');
    expect(button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true').toBe(false);
  });

  it('renders a Back to login link to /login', () => {
    setup();
    expect(screen.getByRole('link', { name: m.backToLogin }).getAttribute('href')).toBe('/login');
  });
});
