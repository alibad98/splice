'use client';

import { useRef } from 'react';
import { useI18n } from '../../i18n/provider';
import { Icon } from './Icon';
import { NavList } from './NavList';

/** Sheet shown below md: a native modal dialog sliding in from the inline-start edge. */
export function MobileNav() {
  const ref = useRef<HTMLDialogElement>(null);
  const { messages } = useI18n();
  const close = () => ref.current?.close();
  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        aria-label={messages.shell.openMenu}
        className="inline-flex size-11 items-center justify-center rounded-pill text-foreground hover:bg-secondary"
      >
        <Icon name="menu" />
      </button>
      <dialog
        ref={ref}
        aria-label={messages.shell.menuTitle}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        className="m-0 h-dvh max-h-dvh w-72 max-w-[85vw] bg-sidebar p-0 text-sidebar-foreground backdrop:bg-black/40 open:flex open:flex-col"
        style={{ insetInlineStart: 0, insetInlineEnd: 'auto' }}
      >
        <div className="flex h-full flex-col p-4">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-body-lg font-bold">{messages.shell.menuTitle}</span>
          <button type="button" onClick={close} aria-label={messages.shell.closeMenu} className="inline-flex size-11 items-center justify-center rounded-pill hover:bg-secondary">
            <Icon name="close" />
          </button>
        </div>
        <NavList onNavigate={close} />
        </div>
      </dialog>
    </div>
  );
}
