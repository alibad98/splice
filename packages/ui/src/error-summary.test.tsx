// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { ErrorSummary } from './error-summary.js';
import { Field } from './field.js';
import { Input } from './input.js';

afterEach(cleanup);

const items = [
  { id: 'title', label: 'Enter a title' },
  { id: 'cta-url', label: 'Use a link on your store domain' },
];

function Form({ focusKey }: { focusKey?: number }) {
  return (
    <form>
      <ErrorSummary title="Fix 2 problems" items={items} focusKey={focusKey} />
      <Field label="Title" htmlFor="title" error="Enter a title">
        <Input />
      </Field>
      <Field label="Link" htmlFor="cta-url" error="Use a link on your store domain">
        <Input />
      </Field>
    </form>
  );
}

describe('ErrorSummary', () => {
  it('is an alert that takes focus on mount and lists one link per error', () => {
    render(<Form />);
    // Field errors are alerts too; the summary is the one with the title.
    const box = screen.getAllByRole('alert').find((el) => el.getAttribute('data-slot') === 'error-summary')!;
    expect(box.textContent).toContain('Fix 2 problems');
    expect(box.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(box);
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Enter a title', 'Use a link on your store domain']);
    expect(links[1]!.getAttribute('href')).toBe('#cta-url');
  });

  it('moves focus to the field when a link is followed', () => {
    render(<Form />);
    fireEvent.click(screen.getByRole('link', { name: 'Use a link on your store domain' }));
    expect(document.activeElement).toBe(document.getElementById('cta-url'));
    expect(document.activeElement?.getAttribute('aria-invalid')).toBe('true');
  });

  it('takes focus again when focusKey changes (a second submit)', () => {
    const { rerender } = render(<Form focusKey={1} />);
    (document.getElementById('title') as HTMLElement).focus();
    rerender(<Form focusKey={2} />);
    expect(document.activeElement?.getAttribute('data-slot')).toBe('error-summary');
  });

  it('renders nothing without items and can skip focusing', () => {
    expect(renderToStaticMarkup(<ErrorSummary title="x" items={[]} />)).toBe('');
    render(
      <>
        <button type="button">before</button>
        <ErrorSummary title="t" items={items} autoFocus={false} />
      </>,
    );
    expect(document.activeElement).toBe(document.body);
  });
});
