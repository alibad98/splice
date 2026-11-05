'use client';

import { useWatch, useFormContext } from 'react-hook-form';
import { cn } from '@slips/ui';
import { useI18n } from '../../../i18n/provider';
import { CTA_STYLE_CLASSES } from './CtaCard';
import type { EditorValues } from './form';

/** A 9:16 ink frame with the title and the CTA pill, until the live player preview lands (Story 3.12). */
export function PreviewPlaceholder() {
  const { messages } = useI18n();
  const m = messages.content.editor;
  const { control } = useFormContext<EditorValues>();
  const [title, format, label, style] = useWatch({ control, name: ['title', 'format', 'cta_label', 'cta_style'] });

  return (
    <div className="flex flex-col items-center gap-3">
      <div data-testid="preview-frame" className="flex aspect-[9/16] w-full max-w-[18rem] flex-col justify-end overflow-hidden rounded-lg border-[6px] border-foreground bg-foreground p-3 shadow-card">
        <div className="flex flex-col gap-3 rounded-md bg-background p-3 text-foreground">
          {/* Merchant text renders as escaped React text. */}
          <p dir="auto" className="line-clamp-3 font-semibold break-words">
            {title || m.untitled[format]}
          </p>
          <span dir="auto" className={cn('inline-flex min-h-10 w-full items-center justify-center truncate rounded-pill border-2 px-4 font-semibold', CTA_STYLE_CLASSES[style])}>
            {label}
          </span>
        </div>
      </div>
      <p className="rounded-pill bg-warning-tint px-3 py-1 text-small font-medium text-warning-text">{m.preview.soon}</p>
    </div>
  );
}
