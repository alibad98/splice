'use client';

import { useI18n } from '../../i18n/provider';

interface SallaButtonProps {
  href?: string;
}

export function SallaButton({ href = 'https://s.salla.sa/auth/register' }: SallaButtonProps) {
  const { messages } = useI18n();

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="w-full h-12 inline-flex items-center justify-center gap-2.5 rounded-xl border border-[#004956]/20 bg-[#F4F9F8] dark:bg-[#004956]/20 text-[#004956] dark:text-[#B9F280] font-semibold text-sm hover:bg-[#E8F3F1] dark:hover:bg-[#004956]/30 active:scale-[0.99] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00B4A0] shadow-sm"
    >
      <span>{messages.auth.signUpViaSalla}</span>
      {/* Salla Bag Icon */}
      <svg className="w-5 h-5 shrink-0" viewBox="0 0 32 32" fill="none">
        <path
          d="M8 10C8 7.79086 9.79086 6 12 6H20C22.2091 6 24 7.79086 24 10V11H8V10Z"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <rect
          x="5"
          y="10"
          width="22"
          height="17"
          rx="4"
          fill="currentColor"
          fillOpacity="0.15"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <path
          d="M13 14V16C13 17.6569 14.3431 19 16 19C17.6569 19 19 17.6569 19 16V14"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    </a>
  );
}
