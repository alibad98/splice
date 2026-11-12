'use client';
// DropZone: a dashed file drop target with a keyboard-openable picker (written from scratch, Story 3.6).
// Files arrive through `onFiles` whether they were dropped or picked; the caller checks and uploads them.
import { useId, useRef, useState, type ComponentProps, type DragEvent, type ReactNode } from 'react';
import { Button } from './button.js';
import { cn } from './cn.js';
import { Icon } from './icon.js';

export interface DropZoneProps extends Omit<ComponentProps<'div'>, 'title' | 'onDrop'> {
  /** Called with the dropped or picked files (never empty). */
  onFiles: (files: File[]) => void;
  /** Main line, e.g. "Drop images or videos here". */
  title: ReactNode;
  /** Secondary line with the limits. */
  hint?: ReactNode;
  /** Label of the picker button, e.g. "Choose files". */
  buttonLabel: ReactNode;
  /** The `accept` attribute of the file input (MIME types or extensions). */
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** Why the zone is disabled (shown instead of the hint and announced with the button). */
  disabledReason?: ReactNode;
  /** Id of the hidden file input (lets an error summary or label point at the picker button). */
  inputId?: string;
}

const hasFiles = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes('Files');

/**
 * Dashed `input-border` drop target (`rounded-lg`, the base radius). The picker button opens the native file dialog
 * (Enter/Space), a click anywhere on the zone does too, and dropped files are accepted while enabled. While files are
 * dragged over it the dashed border gets the same soft amber treatment as focused inputs; nothing animates under reduced motion.
 */
export function DropZone({
  onFiles,
  title,
  hint,
  buttonLabel,
  accept,
  multiple = false,
  disabled = false,
  disabledReason,
  inputId,
  className,
  ...props
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const hintId = `${useId()}-hint`;

  const open = () => {
    if (!disabled) inputRef.current?.click();
  };
  const emit = (list: FileList | null | undefined) => {
    const files = Array.from(list ?? []);
    if (files.length === 0 || disabled) return;
    onFiles(multiple ? files : files.slice(0, 1));
  };

  const onDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current += 1;
    if (!disabled) setDragging(true);
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
  };
  const onDragLeave = () => {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    emit(e.dataTransfer?.files);
  };

  const description = disabled && disabledReason ? disabledReason : hint;

  return (
    <div
      data-slot="drop-zone"
      data-dragging={dragging || undefined}
      data-disabled={disabled || undefined}
      onClick={(e) => {
        // The button opens the picker itself; clicks on the rest of the zone do too.
        if ((e.target as HTMLElement).closest('button, input')) return;
        open();
      }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'ui-drop-zone flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed bg-background px-6 py-8 text-center',
        'transition-[border-color,background-color,box-shadow] duration-150 ease-out motion-reduce:transition-none',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        dragging && 'bg-muted',
        className,
      )}
      {...props}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon name="upload" className="size-5" />
      </span>
      <p className="text-body font-semibold text-foreground">{title}</p>
      {description ? (
        <p id={hintId} className="max-w-prose text-small text-muted-foreground">
          {description}
        </p>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-1"
        aria-describedby={description ? hintId : undefined}
        disabled={disabled}
        onClick={open}
      >
        {buttonLabel}
      </Button>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => {
          emit(e.currentTarget.files);
          // Picking the same file again must fire change again.
          e.currentTarget.value = '';
        }}
      />
    </div>
  );
}
