'use client';

import { Icon } from '@slips/ui';
import { useI18n } from '../../i18n/provider';

interface SallaButtonProps {
  href?: string;
}

/**
 * Sign-up hand-off to Salla (opens in a new tab). Same 44px pill as the kit's large buttons; Salla's own teal
 * is used only as a quiet tint so it reads as "Salla", with the kit's focus ring.
 */
export function SallaButton({ href = 'https://s.salla.sa/auth/register' }: SallaButtonProps) {
  const { messages } = useI18n();

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 w-full items-center justify-center gap-2.5 rounded-pill border border-[#004956]/25 bg-[#004956]/[0.06] px-5 text-body font-semibold text-[#004956] transition-colors duration-150 hover:bg-[#004956]/[0.12] dark:border-[#B9F280]/25 dark:bg-[#B9F280]/[0.08] dark:text-[#B9F280] dark:hover:bg-[#B9F280]/[0.14]"
    >
      <Icon name="store" className="size-5" />
      <span>{messages.auth.signUpViaSalla}</span>
      <Icon name="external" className="size-4 opacity-70" />
    </a>
  );
}
