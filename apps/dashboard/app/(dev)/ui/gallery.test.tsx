// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Gallery } from './Gallery';
import UiGalleryPage from './page';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('UI gallery (dev only)', () => {
  it('shows every built component and switches to Arabic RTL and the dark theme', () => {
    const { container } = render(<Gallery />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('dir')).toBe('ltr');
    for (const name of ['Primary', 'Secondary', 'Create Story', 'Ghost', 'Delete', 'Small', 'Medium', 'Large']) expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Sync products' }).every((b) => b.getAttribute('aria-busy') === 'true')).toBe(true);
    expect(screen.getByRole('button', { name: 'Publish' }).getAttribute('aria-disabled')).toBe('true');
    expect(container.querySelector('[data-slot="spinner"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-slot="progress"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-slot="meter"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-slot="alert"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-slot="banner"]')).toHaveLength(2);
    expect(container.querySelector('[data-slot="error-summary"]')?.getAttribute('role')).toBe('alert');
    expect(container.querySelector('[data-slot="empty-state"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="select-trigger"]')).not.toBeNull();
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelectorAll('[data-slot="status-chip"]')).toHaveLength(10); // 5 tones + processing, ended, archived + 2 in the DataTable demo
    expect(screen.getByRole('region', { name: 'Notifications (F8)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'العربية' }));
    expect(root.getAttribute('dir')).toBe('rtl');
    fireEvent.click(screen.getByRole('button', { name: 'الوضع الداكن' }));
    expect(root.className).toContain('dark');
  });

  it('is not found in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => UiGalleryPage()).toThrow();
  });
});
