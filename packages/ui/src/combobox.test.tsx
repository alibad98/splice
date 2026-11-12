// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Combobox, type ComboboxStatus } from './combobox.js';
import { Field } from './field.js';

afterEach(cleanup);

interface Fruit {
  id: string;
  name: string;
}
const FRUITS: Fruit[] = [
  { id: 'a', name: 'Apple' },
  { id: 'b', name: 'Banana' },
  { id: 'c', name: 'Cherry' },
];

function Harness({ onSelect = () => undefined, status = 'ready', options }: { onSelect?: (f: Fruit) => void; status?: ComboboxStatus; options?: Fruit[] }) {
  const [q, setQ] = useState('');
  const shown = options ?? FRUITS.filter((f) => f.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <Field label="Fruit" htmlFor="fruit">
        <Combobox
          inputValue={q}
          onInputValueChange={setQ}
          options={shown}
          getOptionKey={(f) => f.id}
          renderOption={(f) => <span dir="auto">{f.name}</span>}
          onSelect={onSelect}
          status={status}
          listLabel="Fruits"
          emptyContent="No fruit matches"
          loadingContent="Loading"
          errorContent={
            <span>
              Failed <button type="button">Retry</button>
            </span>
          }
        />
      </Field>
    </form>
  );
}

const input = () => screen.getByRole('combobox');

describe('Combobox', () => {
  it('is an ARIA combobox wired to its Field label, closed until typing', () => {
    render(<Harness />);
    const box = input();
    expect(box.getAttribute('id')).toBe('fruit');
    expect(box.getAttribute('aria-autocomplete')).toBe('list');
    expect(box.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.change(box, { target: { value: 'an' } });
    expect(box.getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByRole('listbox', { name: 'Fruits' });
    expect(box.getAttribute('aria-controls')).toBe(list.id);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Banana']);
  });

  it('moves the active option with the arrows (aria-activedescendant) and picks it with Enter; focus stays on the input', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const box = input();
    box.focus();
    fireEvent.change(box, { target: { value: 'a' } });
    expect(box.getAttribute('aria-activedescendant')).toBeNull();
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    const options = screen.getAllByRole('option');
    expect(box.getAttribute('aria-activedescendant')).toBe(options[1]!.id);
    expect(options[1]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(FRUITS[1]);
    expect(box.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(box);
  });

  it('Escape closes the popup and keeps the typed text; ArrowDown opens it again', () => {
    render(<Harness />);
    const box = input();
    box.focus();
    fireEvent.change(box, { target: { value: 'Ch' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box.getAttribute('aria-expanded')).toBe('false');
    expect((box as HTMLInputElement).value).toBe('Ch');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });

  it('picks an option on click without moving focus; Enter with nothing active does not submit', () => {
    const onSelect = vi.fn();
    const onSubmit = vi.fn((e: Event) => e.preventDefault());
    render(<Harness onSelect={onSelect} />);
    input().closest('form')!.addEventListener('submit', onSubmit);
    const box = input();
    box.focus();
    fireEvent.change(box, { target: { value: 'e' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
    const cherry = screen.getByRole('option', { name: 'Cherry' });
    fireEvent.mouseDown(cherry);
    fireEvent.click(cherry);
    expect(onSelect).toHaveBeenCalledWith(FRUITS[2]);
    expect(document.activeElement).toBe(box);
  });

  it('shows the empty, loading and error contents', () => {
    const { rerender } = render(<Harness options={[]} />);
    fireEvent.change(input(), { target: { value: 'zzz' } });
    expect(screen.getByRole('status').textContent).toBe('No fruit matches');
    rerender(<Harness options={[]} status="loading" />);
    expect(screen.getByRole('status').textContent).toBe('Loading');
    rerender(<Harness options={FRUITS} status="error" />);
    expect(screen.getByRole('status').textContent).toContain('Failed');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('resets the active option when the results change', () => {
    const { rerender } = render(<Harness options={FRUITS} />);
    const box = input();
    fireEvent.change(box, { target: { value: 'x' } });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box.getAttribute('aria-activedescendant')).not.toBeNull();
    act(() => rerender(<Harness options={[FRUITS[2]!]} />));
    expect(box.getAttribute('aria-activedescendant')).toBeNull();
  });

  it('renders on the server without the popup', () => {
    const html = renderToStaticMarkup(<Harness />);
    expect(html).toContain('role="combobox"');
    expect(html).not.toContain('role="listbox"');
  });
});
