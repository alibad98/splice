// Skeleton: muted placeholder blocks (`rounded-sm`, pulse off under `prefers-reduced-motion`).
// Never ship page spinners: pages use skeletons.
import type { ComponentProps } from 'react';
import { cn } from './cn.js';

export interface SkeletonProps extends ComponentProps<'div'> {
  /** Accessible loading label. When provided, wraps the skeleton in a `role="status"` live container. */
  label?: string;
  /** Number of stacked bone rows to render inside a status container (defaults to 1 block when omitted). */
  rows?: number;
}

/**
 * Single bone block or multi-row skeleton container.
 * Uses `data-boneyard-bone` markers for layout-accurate bone blocks and stops pulsing under `prefers-reduced-motion`.
 */
export function Skeleton({ label, rows, className, children, ...props }: SkeletonProps) {
  if (!label && !rows && !children) {
    return (
      <div
        data-slot="skeleton"
        data-boneyard-bone=""
        aria-hidden="true"
        className={cn('animate-pulse rounded-sm bg-muted motion-reduce:animate-none', className)}
        {...props}
      />
    );
  }

  const count = rows && rows > 0 ? rows : 1;
  return (
    <div
      data-slot="skeleton"
      role="status"
      aria-busy="true"
      className={cn('flex w-full flex-col gap-2', className)}
      {...props}
    >
      {label ? <span className="sr-only">{label}</span> : null}
      {children ??
        Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            data-boneyard-bone=""
            aria-hidden="true"
            className={cn('animate-pulse rounded-sm bg-muted motion-reduce:animate-none', i === 0 && count > 1 ? 'h-6 w-full' : 'h-10 w-full')}
          />
        ))}
    </div>
  );
}

