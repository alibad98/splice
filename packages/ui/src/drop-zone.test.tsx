// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DropZone } from './drop-zone.js';

afterEach(cleanup);

const file = (name: string, type = 'image/png') => new File(['x'], name, { type });
const dataTransfer = (files: File[]) => ({ files, types: ['Files'], dropEffect: 'none' });

const zone = () => document.querySelector('[data-slot="drop-zone"]') as HTMLElement;
const input = () => document.querySelector('input[type="file"]') as HTMLInputElement;

describe('DropZone', () => {
  it('renders a dashed input-border zone with title, hint and an accept/multiple file input that is not in the tab order', () => {
    const html = renderToStaticMarkup(
      <DropZone onFiles={() => {}} title="Drop files" hint="Up to 10 MB" buttonLabel="Choose files" accept="image/png,video/mp4" multiple inputId="slides-input" />,
    );
    expect(html).toContain('border-dashed');
    expect(html).toContain('border-input-border');
    expect(html).toContain('rounded-lg');
    expect(html).toContain('accept="image/png,video/mp4"');
    expect(html).toContain('multiple=""');
    expect(html).toContain('id="slides-input"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('Up to 10 MB');
  });

  it('opens the picker from the button (keyboard reachable) and from a click on the zone', () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} title="Drop files" hint="Hint" buttonLabel="Choose files" multiple />);
    const click = vi.spyOn(input(), 'click');
    const button = screen.getByRole('button', { name: 'Choose files' });
    expect(button.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(button.getAttribute('aria-describedby')!)!.textContent).toBe('Hint');
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(click).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Drop files'));
    expect(click).toHaveBeenCalledTimes(2);
  });

  it('emits picked files and resets the input so the same file can be picked again', () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} title="Drop files" buttonLabel="Choose files" multiple />);
    const files = [file('a.png'), file('b.mp4', 'video/mp4')];
    fireEvent.change(input(), { target: { files } });
    expect(onFiles).toHaveBeenCalledWith(files);
    expect(input().value).toBe('');
  });

  it('shows the drag state and emits dropped files in order; a single-file zone keeps the first', () => {
    const onFiles = vi.fn();
    const { rerender } = render(<DropZone onFiles={onFiles} title="Drop files" buttonLabel="Choose files" multiple />);
    const files = [file('1.png'), file('2.png')];
    fireEvent.dragEnter(zone(), { dataTransfer: dataTransfer(files) });
    expect(zone().getAttribute('data-dragging')).toBe('true');
    fireEvent.dragOver(zone(), { dataTransfer: dataTransfer(files) });
    fireEvent.drop(zone(), { dataTransfer: dataTransfer(files) });
    expect(zone().hasAttribute('data-dragging')).toBe(false);
    expect(onFiles).toHaveBeenLastCalledWith(files);

    rerender(<DropZone onFiles={onFiles} title="Drop files" buttonLabel="Choose files" />);
    fireEvent.drop(zone(), { dataTransfer: dataTransfer(files) });
    expect(onFiles).toHaveBeenLastCalledWith([files[0]]);
  });

  it('when disabled shows the reason, disables the picker and ignores drops', () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} title="Drop files" hint="Hint" buttonLabel="Choose files" multiple disabled disabledReason="You reached 10 slides" />);
    expect(screen.getByText('You reached 10 slides')).toBeTruthy();
    expect(screen.queryByText('Hint')).toBeNull();
    expect((screen.getByRole('button', { name: 'Choose files' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.drop(zone(), { dataTransfer: dataTransfer([file('a.png')]) });
    expect(onFiles).not.toHaveBeenCalled();
    expect(zone().getAttribute('data-disabled')).toBe('true');
  });

  it('turns the transition off under reduced motion', () => {
    expect(renderToStaticMarkup(<DropZone onFiles={() => {}} title="t" buttonLabel="b" />)).toContain('motion-reduce:transition-none');
  });
});
