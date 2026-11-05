'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { dialog } from '@slips/ui';

export interface LeaveCopy {
  title: string;
  body: string;
  confirm: string;
  cancel: string;
}

/**
 * Ask before leaving with unsaved or failed changes: in-app link clicks open `dialog.confirm()` (and navigate on
 * Leave); reload, close and off-site navigation use the browser's `beforeunload` prompt.
 */
export function useLeaveGuard(when: boolean, copy: LeaveCopy): void {
  const router = useRouter();
  const state = useRef({ when, copy, router });
  useEffect(() => {
    state.current = { when, copy, router };
  }, [when, copy, router]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!state.current.when) return;
      event.preventDefault();
      // Older browsers need returnValue set to show the prompt.
      event.returnValue = '';
    };

    // Capture phase on the document runs before React's handlers on the root, so Next's <Link> never sees the click.
    const onClick = (event: MouseEvent) => {
      const { when: guard, copy: text, router: nav } = state.current;
      if (!guard || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      // Off-site links unload the page, so beforeunload asks.
      if (url.origin !== window.location.origin) return;
      // In-page links (the error summary) stay.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      void dialog.confirm({
        tone: 'warning',
        title: text.title,
        description: text.body,
        confirmLabel: text.confirm,
        cancelLabel: text.cancel,
        onConfirm: () => {
          state.current.when = false;
          nav.push(`${url.pathname}${url.search}${url.hash}`);
        },
      });
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, []);
}
