import { h, render } from 'preact';
import type {
  ContentProductSummary,
  ManifestSlide,
  StoreManifest,
} from '@slips/contracts';
import type { StorefrontPlatform } from '../platform/types.js';
import type { PreviewLocale } from '../preview/protocol.js';
import { mediaUrl } from '../preview/protocol.js';
import { styles } from './styles.js';
const copy = {
  en: {
    previous: 'Previous',
    next: 'Next',
    slide: 'Slide',
    of: 'of',
    empty: 'Add a slide to see your story here.',
    noItem: 'Save content to start your preview.',
    failed: 'Media unavailable. Replace the media or retry processing.',
    processing:
      'Media is processing. Your preview will update when it is ready.',
    missing: 'No media yet. Add an image or video.',
    unavailable: 'Out of stock',
    options: 'Required options — view options in the store',
    low: 'Limited stock',
    available: 'Available',
    noProduct: 'No purchasable product linked.',
    note: 'Preview: no real cart or analytics',
    cart: 'Added to cart (simulated).',
    product: 'Product navigation simulated.',
    link: 'Link navigation simulated.',
    error: 'Action could not be simulated. Try again.',
    loading: 'Simulating…',
  },
  ar: {
    previous: 'السابق',
    next: 'التالي',
    slide: 'الشريحة',
    of: 'من',
    empty: 'أضف شريحة لتظهر قصتك هنا.',
    noItem: 'احفظ المحتوى لبدء المعاينة.',
    failed: 'الوسائط غير متاحة. استبدلها أو أعد محاولة المعالجة.',
    processing: 'تجري معالجة الوسائط. ستتحدث المعاينة عندما تصبح جاهزة.',
    missing: 'لا توجد وسائط بعد. أضف صورة أو فيديو.',
    unavailable: 'نفد المخزون',
    options: 'خيارات مطلوبة — اعرض الخيارات في المتجر',
    low: 'كمية محدودة',
    available: 'متاح',
    noProduct: 'لا يوجد منتج متاح للشراء مرتبط.',
    note: 'معاينة: لا سلة حقيقية ولا تحليلات',
    cart: 'تمت الإضافة إلى السلة (محاكاة).',
    product: 'تمت محاكاة الانتقال إلى المنتج.',
    link: 'تمت محاكاة الانتقال إلى الرابط.',
    error: 'تعذرت محاكاة الإجراء. حاول مجددًا.',
    loading: 'تجري المحاكاة…',
  },
};
export interface ViewerOptions {
  platform: StorefrontPlatform;
  apiBase: string;
  locale: PreviewLocale;
}
export interface Viewer {
  update(manifest: StoreManifest, locale: PreviewLocale): void;
  destroy(): void;
}
export function selectMedia(slide: ManifestSlide, apiBase: string) {
  if (['failed', 'importing', 'uploaded'].includes(slide.status)) return null;
  const poster =
    slide.poster_url ??
    slide.renditions.find((r) => r.profile === 'poster')?.url ??
    null;
  if (slide.status !== 'processed') {
    const src = mediaUrl(poster ?? slide.source_url, apiBase);
    return src
      ? { kind: poster ? 'image' : slide.kind, src, poster: null }
      : null;
  }
  const rendition = slide.renditions.find((r) =>
    slide.kind === 'image'
      ? r.profile === 'web' && r.content_type.startsWith('image/')
      : ['720p', '480p', '1080p'].includes(r.profile) &&
        r.content_type.startsWith('video/'),
  );
  const src = mediaUrl(rendition?.url ?? null, apiBase);
  return src
    ? { kind: slide.kind, src, poster: mediaUrl(poster, apiBase) }
    : null;
}
export function formatPrice(
  product: ContentProductSummary,
  locale: PreviewLocale,
  minor: number,
): string {
  // Application accounting precision differs from some CLDR currency defaults.
  const corrections: Readonly<Record<string, number>> = { IQD: 3, YER: 2 };
  const currency = product.currency.toUpperCase();
  const digits =
    corrections[currency] ??
    new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits ??
    2;
  const formatter = new Intl.NumberFormat(`${locale}-u-nu-latn`, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return formatter.format(minor / 10 ** digits);
}
/** Shared viewer; effects belong exclusively to the supplied platform port. */
export function mountViewer(
  host: HTMLElement,
  initial: StoreManifest,
  options: ViewerOptions,
): Viewer {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  const originalDir = host.getAttribute('dir'),
    originalLang = host.getAttribute('lang');
  let manifest = initial,
    locale = options.locale,
    selected = 0,
    generation = 0,
    feedback = '',
    pending = false,
    mediaFailed = false,
    productImageFailed = false,
    destroyed = false;
  const stopVideo = () =>
    shadow.querySelectorAll('video').forEach((v) => {
      v.pause();
      v.removeAttribute('src');
      v.load();
    });
  const draw = () => {
    if (destroyed) return;
    host.dir = locale === 'ar' ? 'rtl' : 'ltr';
    host.lang = locale;
    const t = copy[locale],
      item = manifest.items[0],
      slide = item?.slides[selected],
      media =
        slide && !mediaFailed ? selectMedia(slide, options.apiBase) : null;
    const product =
      item?.product && !item.product.deleted ? item.product : null;
    const purchasable =
      product &&
      product.availability !== 'out_of_stock' &&
      !product.has_required_options;
    const enabled =
      item &&
      (item.cta_action === 'open_link'
        ? !!item.cta_url
        : item.cta_action === 'open_product'
          ? !!product
          : !!purchasable);
    const placeholder = !item
      ? t.noItem
      : !slide
        ? t.empty
        : mediaFailed || slide.status === 'failed'
          ? t.failed
          : slide.status !== 'processed'
            ? t.processing
            : t.missing;
    const change = (next: number) => {
      options.platform.selectSlide(next);
      stopVideo();
      selected = next;
      mediaFailed = false;
      draw();
    };
    const act = async () => {
      if (!item || !enabled || pending) return;
      const current = generation;
      pending = true;
      feedback = '';
      draw();
      try {
        const result =
          item.cta_action === 'open_link'
            ? await options.platform.openLink(item.cta_url!)
            : item.cta_action === 'open_product'
              ? await options.platform.openProduct(product!)
              : await options.platform.addToCart(product!);
        if (current !== generation || destroyed) return;
        feedback = t[result];
      } catch {
        if (current === generation && !destroyed) feedback = t.error;
      }
      if (current === generation && !destroyed) {
        pending = false;
        draw();
      }
    };
    const imageUrl =
      product && !productImageFailed
        ? mediaUrl(product.image_url, options.apiBase)
        : null;
    render(
      h(
        'div',
        { class: 'viewer', dir: locale === 'ar' ? 'rtl' : 'ltr', lang: locale },
        h('style', null, styles),
        h(
          'header',
          null,
          h('h1', { dir: 'auto' }, item?.title ?? t.noItem),
          h(
            'span',
            { class: 'position', 'aria-live': 'polite' },
            `${t.slide} ${slide ? selected + 1 : 0} ${t.of} ${item?.slides.length ?? 0}`,
          ),
        ),
        h(
          'div',
          { class: 'segments', 'aria-hidden': 'true' },
          item?.slides.map((s, index) =>
            h('span', { key: s.id, class: index === selected ? 'active' : '' }),
          ),
        ),
        h(
          'div',
          { class: 'media', key: `${generation}-${selected}` },
          media
            ? media.kind === 'video'
              ? h('video', {
                  src: media.src,
                  poster: media.poster ?? undefined,
                  controls: true,
                  playsInline: true,
                  preload: 'metadata',
                  'aria-label': slide?.alt_text ?? item?.title,
                  onError: () => {
                    mediaFailed = true;
                    draw();
                  },
                })
              : h('img', {
                  src: media.src,
                  alt: slide?.alt_text ?? item?.title ?? '',
                  onError: () => {
                    mediaFailed = true;
                    draw();
                  },
                })
            : h('p', { role: 'status' }, placeholder),
          media &&
            slide?.status !== 'processed' &&
            h('span', { class: 'processing' }, t.processing),
        ),
        h(
          'section',
          {
            class: 'dock',
            'aria-label':
              locale === 'ar' ? 'المنتج والإجراء' : 'Product and action',
          },
          product
            ? h(
                'div',
                { class: 'product' },
                imageUrl &&
                  h('img', {
                    src: imageUrl,
                    alt: '',
                    onError: () => {
                      productImageFailed = true;
                      draw();
                    },
                  }),
                h(
                  'div',
                  { class: 'details' },
                  h('strong', { dir: 'auto' }, product.name),
                  h(
                    'div',
                    { class: 'price' },
                    product.sale_price_minor !== null &&
                      h(
                        'del',
                        null,
                        h(
                          'bdi',
                          null,
                          formatPrice(product, locale, product.price_minor),
                        ),
                      ),
                    h(
                      'bdi',
                      null,
                      formatPrice(
                        product,
                        locale,
                        product.sale_price_minor ?? product.price_minor,
                      ),
                    ),
                  ),
                  h(
                    'p',
                    { class: 'availability' },
                    product.availability === 'out_of_stock'
                      ? t.unavailable
                      : product.availability === 'low'
                        ? t.low
                        : t.available,
                  ),
                  product.has_required_options &&
                    h('p', { class: 'availability' }, t.options),
                ),
              )
            : item && h('p', { class: 'availability' }, t.noProduct),
          item &&
            h(
              'button',
              {
                class: `cta ${item.cta_style ?? 'ink'}`,
                disabled: !enabled || pending,
                onClick: act,
                dir: 'auto',
              },
              pending ? t.loading : item.cta_label,
            ),
          h(
            'div',
            { class: 'feedback', role: 'status', 'aria-live': 'polite' },
            feedback,
          ),
        ),
        h(
          'nav',
          { 'aria-label': locale === 'ar' ? 'شرائح القصة' : 'Story slides' },
          h(
            'button',
            {
              disabled: selected === 0 || !slide,
              onClick: () => change(selected - 1),
            },
            t.previous,
          ),
          h(
            'button',
            {
              disabled: !item || selected >= item.slides.length - 1 || !slide,
              onClick: () => change(selected + 1),
            },
            t.next,
          ),
        ),
        h('p', { class: 'safety' }, t.note),
      ),
      shadow,
    );
  };
  draw();
  return {
    update(next, nextLocale) {
      stopVideo();
      generation++;
      manifest = next;
      locale = nextLocale;
      selected = 0;
      feedback = '';
      pending = false;
      mediaFailed = false;
      productImageFailed = false;
      draw();
    },
    destroy() {
      if (destroyed) return;
      stopVideo();
      destroyed = true;
      generation++;
      render(null, shadow);
      for (const [key, value] of [
        ['dir', originalDir],
        ['lang', originalLang],
      ]) {
        if (value === null) host.removeAttribute(key!);
        else host.setAttribute(key!, value!);
      }
    },
  };
}
