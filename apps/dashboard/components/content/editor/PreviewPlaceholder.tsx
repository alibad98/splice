'use client';

import { useWatch, useFormContext } from 'react-hook-form';
import type { ContentProductSummary } from '@slips/contracts';
import { cn } from '@slips/ui';
import { useI18n } from '../../../i18n/provider';
import { CTA_STYLE_CLASSES } from './CtaCard';
import type { EditorValues } from './form';

/**
 * A 9:16 ink frame with the title and the CTA pill, until the live player preview lands (Story 3.12). An add-to-cart
 * button on a product with required options reads "View options", with a note saying why (Story 3.4).
 */
export function PreviewPlaceholder({ product = null }: { product?: ContentProductSummary | null }) {
  const { messages } = useI18n();
  const m = messages.content.editor;
  const { control } = useFormContext<EditorValues>();
  const [title, format, label, style, action] = useWatch({ control, name: ['title', 'format', 'cta_label', 'cta_style', 'cta_action'] });
  const viewOptions = Boolean(product?.has_required_options && !product.deleted && action === 'add_to_cart');

  return (
    <div className="flex flex-col items-center gap-3">
      <div data-testid="preview-frame" className="flex aspect-[9/16] w-full max-w-[18rem] flex-col justify-end overflow-hidden rounded-lg border-[6px] border-foreground bg-foreground p-3 shadow-card">
        <div className="flex flex-col gap-3 rounded-md bg-background p-3 text-foreground">
          {/* Merchant text renders as escaped React text. */}
          <p dir="auto" className="line-clamp-3 font-semibold break-words">
            {title || m.untitled[format]}
          </p>
          <span
            dir="auto"
            data-testid="preview-cta"
            className={cn('inline-flex min-h-10 w-full items-center justify-center truncate rounded-pill border-2 px-4 font-semibold', CTA_STYLE_CLASSES[style])}
          >
            {viewOptions ? m.product.viewOptions : label}
          </span>
        </div>
      </div>
      {viewOptions ? <p className="max-w-[18rem] text-center text-small text-muted-foreground">{m.product.optionsNote}</p> : null}
      <p className="rounded-pill bg-warning-tint px-3 py-1 text-small font-medium text-warning-text">{m.preview.soon}</p>
    </div>
  );
}
