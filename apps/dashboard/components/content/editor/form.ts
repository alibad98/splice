import { z } from 'zod';
import {
  CONTENT_TITLE_MAX,
  CTA_LABEL_MAX,
  ContentFields,
  ContentFormat,
  CtaAction,
  CtaStyle,
  DEFAULT_CTA_STYLE,
  MediaKind,
  SLIDE_ALT_MAX,
  isStoreDomainUrl,
  type ContentCreateInput,
  type ContentItem,
  type ContentUpdateInput,
} from '@slips/contracts';

/**
 * One slide row of the editor (Story 3.6), in slide order. `key` is stable for the row's life (the saved slide id, or a
 * local id for a new upload). `media_asset_id` is null until the upload completes, and again when a new upload's asset
 * failed: such rows are shown but never sent. `alt_text` is a plain string (empty when none).
 */
export interface SlideValue {
  key: string;
  media_asset_id: string | null;
  kind: MediaKind;
  alt_text: string;
}

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
  /** The slides in order (Story 3.6), uploads in progress included. */
  slides: SlideValue[];
}

/** Keys into `messages.content.editor.errors`; the schema reports these instead of text so errors follow the active language. */
export type EditorErrorKey =
  | 'titleRequired'
  | 'titleTooLong'
  | 'labelRequired'
  | 'labelTooLong'
  | 'urlRequired'
  | 'urlInvalid'
  | 'urlDomain'
  | 'urlNoDomain'
  | 'altRequired'
  | 'altTooLong';

/** Field order, for the error summary. `slides` expands to one entry per slide alt field. */
export const EDITOR_FIELDS = ['title', 'format', 'slides', 'product_id', 'cta_label', 'cta_action', 'cta_url', 'cta_style'] as const satisfies readonly (keyof EditorValues)[];
export type EditorField = (typeof EDITOR_FIELDS)[number];

/** DOM ids of the fields, so the error summary can link to them. */
export const fieldId = (field: EditorField): string => `content-${field.replaceAll('_', '-')}`;

/** DOM id of a slide's alt text field: by asset once uploaded, else by the row key. */
export const slideAltId = (slide: Pick<SlideValue, 'key' | 'media_asset_id'>): string => `slide-alt-${slide.media_asset_id ?? slide.key}`;

/** Alt text as sent: trimmed, blank as null (the API stores it the same way). */
const altOf = (s: SlideValue): string | null => {
  const trimmed = s.alt_text.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const SlideValueSchema = z.object({ key: z.string(), media_asset_id: z.string().nullable(), kind: MediaKind, alt_text: z.string() });

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
      slides: z.array(SlideValueSchema),
    })
    .superRefine((v, ctx) => {
      // Image slides need alt text before any save, Drafts included (Story 3.6); rows still uploading are not sent yet.
      v.slides.forEach((s, i) => {
        if (s.media_asset_id === null) return;
        const path = ['slides', i, 'alt_text'];
        if (s.alt_text.length > SLIDE_ALT_MAX) ctx.addIssue({ code: 'custom', path, message: 'altTooLong' satisfies EditorErrorKey });
        else if (s.kind === 'image' && s.alt_text.trim().length === 0) ctx.addIssue({ code: 'custom', path, message: 'altRequired' satisfies EditorErrorKey });
      });
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
    slides: v.slides.flatMap((s) => (s.media_asset_id ? [{ media_asset_id: s.media_asset_id, alt_text: altOf(s) }] : [])),
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
    slides: item.slides.map((s) => ({ key: s.id, media_asset_id: s.media_asset_id, kind: s.kind, alt_text: s.alt_text ?? '' })),
  };
}

/** A new item: Story, Add to cart, the button text in the UI language, ink style, no product, no slides. */
export function newItemValues(ctaLabel: string): EditorValues {
  return { title: '', format: 'story', cta_label: ctaLabel, cta_action: 'add_to_cart', cta_url: '', cta_style: DEFAULT_CTA_STYLE, product_id: null, slides: [] };
}

/** A stable key of what would be sent; equal keys mean nothing to save. */
export const saveKey = (v: EditorValues): string => JSON.stringify(toInput(v));

/** Only the fields that differ from the saved item. Moving off open link sends `cta_url: null` with the action. */
export function patchOf(saved: EditorValues, next: EditorValues): ContentUpdateInput {
  const a = toInput(saved);
  const b = toInput(next);
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(b) as (keyof ContentCreateInput)[]) {
    if (JSON.stringify(a[key] ?? null) !== JSON.stringify(b[key] ?? null)) patch[key] = b[key] ?? null;
  }
  return patch as ContentUpdateInput;
}
