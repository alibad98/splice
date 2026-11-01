'use client';

import { useState, type ReactNode } from 'react';
import { Button, Card, CardTitle, Spinner, StatusChip, Toaster, toast, type ButtonSize, type ButtonVariant, type StatusTone } from '@slips/ui';
import { directionOf, type Locale } from '../../../i18n/config';

// Dev-only copy (not part of the merchant catalogs); every visible string comes from here, in both languages.
const COPY = {
  en: {
    title: 'UI kit gallery',
    intro: 'Every built component in Arabic and English, light and dark. Turn on reduced motion in the OS or DevTools to check that nothing animates.',
    language: 'العربية',
    theme: { light: 'Dark theme', dark: 'Light theme' },
    sections: { button: 'Button', buttonStates: 'Button sizes and states', spinner: 'Spinner', toast: 'Toast', chip: 'StatusChip' },
    variants: { primary: 'Primary', secondary: 'Secondary', accent: 'Create Story', ghost: 'Ghost', destructive: 'Delete' } satisfies Record<ButtonVariant, string>,
    sizes: { sm: 'Small', md: 'Medium', lg: 'Large' } satisfies Record<ButtonSize, string>,
    pending: 'Sync products',
    unavailable: 'Publish',
    unavailableReason: 'Connect your store before publishing',
    spinnerLabel: 'Loading',
    toasts: {
      plain: 'Plain toast',
      plainTitle: 'Changes saved',
      success: 'Success toast',
      successTitle: 'Products updated',
      action: 'Action toast',
      actionTitle: "We couldn't sync your products. Your current list is still here.",
      actionLabel: 'Retry',
      retried: 'Retrying...',
    },
    chips: { neutral: 'Draft', info: 'Scheduled', success: 'Published', warning: 'Deactivated', danger: 'Failed' } satisfies Record<StatusTone, string>,
    toaster: 'Notifications ({hotkey})',
    close: 'Close notification',
  },
  ar: {
    title: 'معرض مكونات الواجهة',
    intro: 'كل المكونات الجاهزة بالعربية والإنجليزية، فاتح وداكن. فعّل تقليل الحركة من النظام أو أدوات المطور لتتأكد أن لا شيء يتحرك.',
    language: 'English',
    theme: { light: 'الوضع الداكن', dark: 'الوضع الفاتح' },
    sections: { button: 'الأزرار', buttonStates: 'أحجام الأزرار وحالاتها', spinner: 'مؤشر التحميل', toast: 'الإشعارات', chip: 'شارة الحالة' },
    variants: { primary: 'أساسي', secondary: 'ثانوي', accent: 'أنشئ ستوري', ghost: 'شفاف', destructive: 'احذف' } satisfies Record<ButtonVariant, string>,
    sizes: { sm: 'صغير', md: 'متوسط', lg: 'كبير' } satisfies Record<ButtonSize, string>,
    pending: 'زامن المنتجات',
    unavailable: 'انشر',
    unavailableReason: 'اربط متجرك قبل النشر',
    spinnerLabel: 'نحمّل',
    toasts: {
      plain: 'إشعار عادي',
      plainTitle: 'تم حفظ التغييرات',
      success: 'إشعار نجاح',
      successTitle: 'تم تحديث المنتجات',
      action: 'إشعار بإجراء',
      actionTitle: 'ما قدرنا نزامن منتجاتك. قائمتك الحالية باقية.',
      actionLabel: 'حاول مرة ثانية',
      retried: 'نحاول مرة ثانية...',
    },
    chips: { neutral: 'مسودة', info: 'مجدول', success: 'منشور', warning: 'موقوف', danger: 'فشل' } satisfies Record<StatusTone, string>,
    toaster: 'الإشعارات ({hotkey})',
    close: 'أغلق الإشعار',
  },
} as const;

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'accent', 'ghost', 'destructive'];
const SIZES: ButtonSize[] = ['sm', 'md', 'lg'];
const TONES: StatusTone[] = ['neutral', 'info', 'success', 'warning', 'danger'];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </Card>
  );
}

/** The gallery itself: language and theme switch locally, so every component can be checked in all four combinations. */
export function Gallery() {
  const [locale, setLocale] = useState<Locale>('en');
  const [dark, setDark] = useState(false);
  const c = COPY[locale];
  const dir = directionOf(locale);
  return (
    <div lang={locale} dir={dir} className={`${dark ? 'dark' : 'light'} min-h-dvh bg-page p-(--page-padding) text-foreground`}>
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-h1">{c.title}</h1>
            <p className="max-w-prose text-body text-muted-foreground">{c.intro}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setLocale(locale === 'en' ? 'ar' : 'en')}>
              {c.language}
            </Button>
            <Button variant="ghost" onClick={() => setDark(!dark)}>
              {dark ? c.theme.dark : c.theme.light}
            </Button>
          </div>
        </header>

        <Section title={c.sections.button}>
          {VARIANTS.map((v) => (
            <Button key={v} variant={v}>
              {c.variants[v]}
            </Button>
          ))}
        </Section>
        <Section title={c.sections.buttonStates}>
          {SIZES.map((s) => (
            <Button key={s} variant="primary" size={s}>
              {c.sizes[s]}
            </Button>
          ))}
          <Button variant="secondary" pending>
            {c.pending}
          </Button>
          <Button variant="primary" pending>
            {c.pending}
          </Button>
          <Button variant="accent" unavailableReason={c.unavailableReason}>
            {c.unavailable}
          </Button>
        </Section>

        <Section title={c.sections.spinner}>
          <Spinner label={c.spinnerLabel} />
          <span className="text-h2">
            <Spinner />
          </span>
        </Section>

        <Section title={c.sections.toast}>
          <Button onClick={() => toast({ title: c.toasts.plainTitle })}>{c.toasts.plain}</Button>
          <Button onClick={() => toast({ title: c.toasts.successTitle, tone: 'success' })}>{c.toasts.success}</Button>
          <Button
            onClick={() =>
              toast({ title: c.toasts.actionTitle, tone: 'danger', action: { label: c.toasts.actionLabel, onClick: () => toast({ title: c.toasts.retried }) } })
            }
          >
            {c.toasts.action}
          </Button>
        </Section>

        <Section title={c.sections.chip}>
          {TONES.map((t) => (
            <StatusChip key={t} tone={t}>
              {c.chips[t]}
            </StatusChip>
          ))}
        </Section>
      </div>
      <Toaster key={locale} label={c.toaster} closeLabel={c.close} dir={dir} />
    </div>
  );
}
