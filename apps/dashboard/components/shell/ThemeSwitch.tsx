'use client';

import { ThemeToggle } from '@slips/ui';
import { useI18n } from '../../i18n/provider';

/** The kit's animated theme toggle with the app's ar/en labels. */
export function ThemeSwitch({ className }: { className?: string }) {
  const { messages } = useI18n();
  return <ThemeToggle lightLabel={messages.shell.themeLight} darkLabel={messages.shell.themeDark} className={className} />;
}
