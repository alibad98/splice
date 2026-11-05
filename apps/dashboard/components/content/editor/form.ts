import { z } from 'zod';
import {
  CONTENT_TITLE_MAX,
  CTA_LABEL_MAX,
  ContentFields,
  ContentFormat,
  CtaAction,
  CtaStyle,
  DEFAULT_CTA_STYLE,
  isStoreDomainUrl,
  type ContentCreateInput,
  type ContentItem,
  type ContentUpdateInput,
} from '@slips/contracts';

/** What the editor form holds. `cta_url` is a plain string (empty when unused); it is sent as `null` unless the action is open link. */
export interface EditorValues {
  title: string;
  format: ContentFormat;
  cta_label: string;
  cta_action: CtaAction;
  cta_url: string;
  cta_style: CtaStyle;
  /** The one linked catalog product (Story 3.4); null when none. */
  product_id: string | null;
}

/** Keys into `messages.content.editor.errors`; the schema reports these instead of text so errors follow the active language. */
export type EditorErrorKey = 'titleRequired' | 'titleTooLong' | 'labelRequired' | 'labelTooLong' | 'urlRequired' | 'urlInvalid' | 'urlDomain' | 'urlNoDomain';

/** Field order, for the error summary. */
export const EDITOR_FIELDS = ['title', 'format', 'product_id', 'cta_label', 'cta_action', 'cta_url', 'cta_style'] as const satisfies readonly (keyof EditorValues)[];
export type EditorField = (typeof EDITOR_FIELDS)[number];

/** DOM ids of the fields, so the error summary can link to them. */
export const fieldId = (field: EditorField): string => `content-${field.replaceAll('_', '-')}`;

const contractUrl = ContentFields.shape.cta_url;

/**
 * The editor's validation: the contract's bounds and rules, plus the store-domain check for open-link URLs (the API
 * repeats it). Messages are `EditorErrorKey`s. Merchant text is kept exactly as typed (no trimming).
 */
export function editorSchema(domains: readonly string[]) {
  return z
    .object({
      title: z.string().min(1, 'titleRequired').max(CONTENT_TITLE_MAX, 'titleTooLong'),
      format: ContentFormat,
      cta_label: z.string().min(1, 'labelRequired').max(CTA_LABEL_MAX, 'labelTooLong'),
      cta_action: CtaAction,
      cta_url: z.string(),
      cta_style: CtaStyle,
      product_id: z.uuid().nullable(),
    })
    .superRefine((v, ctx) => {
      if (v.cta_action !== 'open_link') return;
      const issue = (message: EditorErrorKey) => ctx.addIssue({ code: 'custom', path: ['cta_url'], message });
      if (v.cta_url.length === 0) return issue('urlRequired');
      if (!contractUrl.safeParse(v.cta_url).success) return issue('urlInvalid');
      if (domains.length === 0) return issue('urlNoDomain');
      if (!isStoreDomainUrl(v.cta_url, domains)) return issue('urlDomain');
    });
}

/** The API body for these values. */
export function toInput(v: EditorValues): ContentCreateInput {
  return {
    title: v.title,
    format: v.format,
    cta_label: v.cta_label,
    cta_action: v.cta_action,
    cta_url: v.cta_action === 'open_link' ? v.cta_url : null,
    cta_style: v.cta_style,
    product_id: v.product_id,
  };
}

/** Form values of a saved item. A missing style is the default, ink. */
export function fromItem(item: ContentItem): EditorValues {
  return {
    title: item.title,
    format: item.format,
    cta_label: item.cta_label,
    cta_action: item.cta_action,
    cta_url: item.cta_url ?? '',
    cta_style: item.cta_style ?? DEFAULT_CTA_STYLE,
    product_id: item.product?.id ?? null,
  };
}

/** A new item: Story, Add to cart, the button text in the UI language, ink style, no product. */
export function newItemValues(ctaLabel: string): EditorValues {
  return { title: '', format: 'story', cta_label: ctaLabel, cta_action: 'add_to_cart', cta_url: '', cta_style: DEFAULT_CTA_STYLE, product_id: null };
}

/** A stable key of what would be sent; equal keys mean nothing to save. */
export const saveKey = (v: EditorValues): string => JSON.stringify(toInput(v));

/** Only the fields that differ from the saved item. Moving off open link sends `cta_url: null` with the action. */
export function patchOf(saved: EditorValues, next: EditorValues): ContentUpdateInput {
  const a = toInput(saved);
  const b = toInput(next);
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(b) as (keyof ContentCreateInput)[]) {
    if ((a[key] ?? null) !== (b[key] ?? null)) patch[key] = b[key] ?? null;
  }
  return patch as ContentUpdateInput;
}
