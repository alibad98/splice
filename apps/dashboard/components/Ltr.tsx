import type { ReactNode } from 'react';

/** Isolates an LTR token (URL, ID, SKU) inside RTL text. */
export function Ltr({ children }: { children: ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}
