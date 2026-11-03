'use client';

import { useState, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Banner,
  Button,
  Card,
  CardTitle,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Icon,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  Input,
  Label,
  Meter,
  Pagination,
  OtpInput,
  PasswordInput,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  Skeleton,
  Spinner,
  StatusChip,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  ThemeToggle,
  Toaster,
  DialogHost,
  dialog,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  toast,
  type BadgeTone,
  type BadgeVariant,
  type ButtonSize,
  type ButtonVariant,
  type StatusTone,
} from '@slips/ui';
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
    chipExtras: { processing: 'Processing', ended: 'Ended', archived: 'Archived' },
    table: { title: 'DataTable (row activation)', label: 'Stories', name: 'Title', status: 'Status', opened: 'Opened', rows: ['Summer abayas', 'Eid perfume'] },
    toaster: 'Notifications ({hotkey})',
    close: 'Close notification',
    kit: {
      badge: 'Badge', badgeTones: { neutral: 'Draft', brand: 'New', accent: 'Pro plan', info: 'Scheduled', success: 'Live', warning: 'Low stock', danger: 'Failed' }, verified: 'Verified for Salla', syncingNow: 'Syncing', small: 'Small', medium: 'Medium', large: 'Large',
      feedback: 'Progress and meter', alerts: 'Alert and banner', empty: 'Empty state and skeleton', pagination: 'Pagination', pages: 'Pages', range: (r: { from: number; to: number; total: number }) => `${r.from}-${r.to} of ${r.total}`, previous: 'Previous', next: 'Next', rowsPerPage: 'Rows per page', forms: 'Form controls', overlays: 'Dialogs, menus and tooltips', themeSection: 'Theme toggle', tabsSection: 'Tabs',
      uploading: 'Uploading video', syncing: 'Syncing products', stories: 'Stories this month', n: (a: number, b: number) => `${a} of ${b}`,
      errorTitle: 'We could not load your stories', errorBody: 'Your other blocks are fine.', retry: 'Retry', warnTitle: 'Two products are out of stock', okTitle: 'Settings saved', dismiss: 'Dismiss',
      offline: 'You are offline. Changes will sync when you reconnect.', disconnected: 'Your store is disconnected from Salla.', reconnect: 'Reconnect',
      emptyTitle: 'No stories yet', firstStory: 'Create your first story', emptyBody: 'Create your first story from a product video.', filtered: 'No products match your filters.', loading: 'Loading',
      email: 'Email address', emailHint: 'We send sign-in codes here.', emailPh: 'you@store.com', password: 'Password', passwordError: 'At least 8 characters', show: 'Show password', hide: 'Hide password',
      notes: 'Notes', notesPh: 'Anything shoppers should know', category: 'Category', all: 'All categories', abayas: 'Abayas', bags: 'Bags', perfume: 'Perfume',
      terms: 'Show prices with VAT', autosync: 'Sync products automatically', code: 'Verification code', digit: 'Digit', of: 'of',
      tabStories: 'Stories', tabReels: 'Reels', tabStoriesBody: 'Stories show at the top of your store.', tabReelsBody: 'Reels play on product pages.',
      openDialog: 'Open dialog', dialogTitle: 'Rename story', dialogBody: 'Shoppers see this name under the story ring.', save: 'Save', cancel: 'Cancel',
      openConfirm: 'Delete story...', confirmTitle: 'Delete “Summer abayas”?', confirmBody: 'It disappears from your store right away. This cannot be undone.', confirmDelete: 'Delete story',
      globalDanger: 'Sign out (global, danger)...', globalWarning: 'Unsaved changes (warning)...', globalNeutral: 'Publish (neutral)...',
      signOutTitle: 'Sign out of Slips?', signOutBody: 'To get back to your dashboard you will sign in with Salla again.', signOut: 'Sign out', stay: 'Stay signed in',
      leaveTitle: 'Leave without saving?', leaveBody: 'Your caption edits on “Summer abayas” will be lost.', leave: 'Leave', keepEditing: 'Keep editing',
      publishTitle: 'Publish 3 Stories now?', publishBody: 'Shoppers see them at the top of your store right away.', publish: 'Publish',
      openSheet: 'Open sheet', sheetTitle: 'Support', openMenu: 'Story actions', menuLabel: 'Story', edit: 'Edit', duplicate: 'Duplicate', remove: 'Delete',
      tipTrigger: 'What is CVR?', tip: 'Orders divided by story views, last 30 days.', toLight: 'Switch to light theme', toDark: 'Switch to dark theme',
    },
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
    chipExtras: { processing: 'قيد المعالجة', ended: 'منتهي', archived: 'مؤرشف' },
    table: { title: 'جدول البيانات (فتح الصف)', label: 'الستوريز', name: 'العنوان', status: 'الحالة', opened: 'فتحنا', rows: ['عبايات الصيف', 'عطر العيد'] },
    toaster: 'الإشعارات ({hotkey})',
    close: 'أغلق الإشعار',
    kit: {
      badge: 'الشارة', badgeTones: { neutral: 'مسودة', brand: 'جديد', accent: 'الباقة الاحترافية', info: 'مجدول', success: 'مباشر', warning: 'مخزون منخفض', danger: 'فشل' }, verified: 'معتمد لمتجر سلة', syncingNow: 'نزامن الآن', small: 'صغيرة', medium: 'متوسطة', large: 'كبيرة',
      feedback: 'التقدم والعداد', alerts: 'التنبيه والشريط', empty: 'الحالة الفارغة والهيكل', pagination: 'التنقل بين الصفحات', pages: 'الصفحات', range: (r: { from: number; to: number; total: number }) => `${r.from}-${r.to} من ${r.total}`, previous: 'السابق', next: 'التالي', rowsPerPage: 'عدد الصفوف', forms: 'عناصر النماذج', overlays: 'النوافذ والقوائم والتلميحات', themeSection: 'مبدّل الوضع', tabsSection: 'التبويبات',
      uploading: 'نرفع الفيديو', syncing: 'نزامن المنتجات', stories: 'ستوريز هذا الشهر', n: (a: number, b: number) => `${a} من ${b}`,
      errorTitle: 'ما قدرنا نحمّل الستوريز', errorBody: 'باقي الأقسام تعمل بشكل طبيعي.', retry: 'حاول مرة ثانية', warnTitle: 'منتجان نفدا من المخزون', okTitle: 'تم حفظ الإعدادات', dismiss: 'إغلاق',
      offline: 'أنت غير متصل. ستتم مزامنة التغييرات عند عودة الاتصال.', disconnected: 'متجرك غير مرتبط بسلة.', reconnect: 'أعد الربط',
      emptyTitle: 'لا توجد ستوريز بعد', firstStory: 'أنشئ أول ستوري', emptyBody: 'أنشئ أول ستوري من فيديو منتج.', filtered: 'لا توجد منتجات تطابق الفلاتر.', loading: 'نحمّل',
      email: 'البريد الإلكتروني', emailHint: 'نرسل رموز الدخول إلى هذا البريد.', emailPh: 'you@store.com', password: 'كلمة المرور', passwordError: '8 أحرف على الأقل', show: 'إظهار كلمة المرور', hide: 'إخفاء كلمة المرور',
      notes: 'ملاحظات', notesPh: 'أي شيء يهم المتسوقين', category: 'التصنيف', all: 'كل التصنيفات', abayas: 'عبايات', bags: 'حقائب', perfume: 'عطور',
      terms: 'اعرض الأسعار شاملة الضريبة', autosync: 'زامن المنتجات تلقائيًا', code: 'رمز التحقق', digit: 'الرقم', of: 'من',
      tabStories: 'ستوريز', tabReels: 'ريلز', tabStoriesBody: 'تظهر الستوريز أعلى متجرك.', tabReelsBody: 'تعمل الريلز في صفحات المنتجات.',
      openDialog: 'افتح النافذة', dialogTitle: 'غيّر اسم الستوري', dialogBody: 'يرى المتسوقون هذا الاسم تحت حلقة الستوري.', save: 'احفظ', cancel: 'إلغاء',
      openConfirm: 'احذف الستوري...', confirmTitle: 'حذف «عبايات الصيف»؟', confirmBody: 'ستختفي من متجرك فورًا. لا يمكن التراجع.', confirmDelete: 'احذف الستوري',
      globalDanger: 'تسجيل الخروج (عام، خطر)...', globalWarning: 'تغييرات غير محفوظة (تنبيه)...', globalNeutral: 'نشر (محايد)...',
      signOutTitle: 'تسجيل الخروج من سليبس؟', signOutBody: 'للعودة إلى لوحة التحكم ستسجّل الدخول عبر سلة من جديد.', signOut: 'سجّل الخروج', stay: 'ابقَ مسجّلًا',
      leaveTitle: 'المغادرة دون حفظ؟', leaveBody: 'ستضيع تعديلاتك على وصف «عبايات الصيف».', leave: 'غادر', keepEditing: 'تابع التعديل',
      publishTitle: 'نشر 3 ستوريز الآن؟', publishBody: 'سيراها المتسوقون أعلى متجرك فورًا.', publish: 'انشر',
      openSheet: 'افتح اللوحة', sheetTitle: 'الدعم', openMenu: 'إجراءات الستوري', menuLabel: 'الستوري', edit: 'تعديل', duplicate: 'تكرار', remove: 'حذف',
      tipTrigger: 'ما معنى CVR؟', tip: 'الطلبات مقسومة على مشاهدات الستوري، آخر 30 يومًا.', toLight: 'التبديل إلى الوضع الفاتح', toDark: 'التبديل إلى الوضع الداكن',
    },
  },
} as const;

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'accent', 'ghost', 'destructive'];
const SIZES: ButtonSize[] = ['sm', 'md', 'lg'];
const BADGE_TONES: BadgeTone[] = ['neutral', 'brand', 'accent', 'info', 'success', 'warning', 'danger'];
const BADGE_VARIANTS: BadgeVariant[] = ['soft', 'solid', 'outline'];
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
  const [otp, setOtp] = useState('');
  const [category, setCategory] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pager, setPager] = useState({ page: 1, size: 10 });
  const c = COPY[locale];
  const k = c.kit;
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
          <StatusChip tone="info" pulse>
            {c.chipExtras.processing}
          </StatusChip>
          <StatusChip tone="neutral" variant="outline" dot={false}>
            {c.chipExtras.ended}
          </StatusChip>
          <StatusChip tone="neutral" variant="outline" icon={<Icon name="archive" />}>
            {c.chipExtras.archived}
          </StatusChip>
        </Section>

        <Section title={c.table.title}>
          <DataTable
            className="w-full"
            label={c.table.label}
            data={c.table.rows.map((name, i) => ({ id: String(i), name, failed: i === 1 }))}
            getRowId={(r) => r.id}
            columns={[
              { id: 'name', header: c.table.name, cell: (r) => <span dir="auto">{r.name}</span> },
              { id: 'status', header: c.table.status, cell: (r) => (r.failed ? <StatusChip tone="danger">{c.chips.danger}</StatusChip> : <StatusChip tone="success">{c.chips.success}</StatusChip>) },
            ]}
            onRowActivate={(r) => toast({ title: `${c.table.opened}: ${r.name}` })}
            rowClassName={(r) => (r.failed ? 'bg-destructive/6 hover:bg-destructive/10' : undefined)}
          />
        </Section>

        <Section title={k.badge}>
          <div className="flex w-full flex-col gap-3">
            {BADGE_VARIANTS.map((variant) => (
              <div key={variant} className="flex flex-wrap items-center gap-2">
                {BADGE_TONES.map((tone) => (
                  <Badge key={tone} tone={tone} variant={variant}>
                    {k.badgeTones[tone]}
                  </Badge>
                ))}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <Badge size="sm" tone="brand">{k.small}</Badge>
              <Badge size="md" tone="brand">{k.medium}</Badge>
              <Badge size="lg" tone="brand">{k.large}</Badge>
              <Badge size="lg" tone="accent" variant="outline" icon="check">{k.verified}</Badge>
              <Badge tone="info" dot pulse>{k.syncingNow}</Badge>
              <Badge tone="success" variant="solid" dot pulse>{k.badgeTones.success}</Badge>
            </div>
          </div>
        </Section>

        <Section title={k.feedback}>
          <div className="flex w-full flex-col gap-4">
            <Progress value={40} label={k.uploading} />
            <Progress label={k.syncing} />
            {[5, 8, 10].map((v) => (
              <Meter key={v} value={v} max={10} label={k.stories} valueLabel={k.n(v, 10)} />
            ))}
          </div>
        </Section>

        <Section title={k.pagination}>
          <Pagination
            className="w-full"
            page={pager.page}
            pageSize={pager.size}
            total={23}
            onPageChange={(page) => setPager({ ...pager, page })}
            pageSizes={[10, 25, 50]}
            onPageSizeChange={(size) => setPager({ page: 1, size })}
            labels={{ nav: k.pages, summary: k.range, previous: k.previous, next: k.next, pageSize: k.rowsPerPage }}
          />
        </Section>

        <Section title={k.alerts}>
          <div className="flex w-full flex-col gap-3">
            <Alert tone="danger" title={k.errorTitle} description={k.errorBody} action={{ label: k.retry, onClick: () => undefined }} />
            <Alert tone="warning" title={k.warnTitle} />
            <Alert tone="success" title={k.okTitle} onDismiss={() => undefined} dismissLabel={k.dismiss} />
            <Banner tone="warning">{k.offline}</Banner>
            <Banner tone="danger" action={{ label: k.reconnect, onClick: () => undefined }}>
              {k.disconnected}
            </Banner>
          </div>
        </Section>

        <Section title={k.empty}>
          <div className="grid w-full gap-4 sm:grid-cols-2">
            <EmptyState title={k.emptyTitle} description={k.emptyBody} action={<Button variant="accent">{k.firstStory}</Button>} />
            <EmptyState variant="filtered" description={k.filtered} />
            <Skeleton label={k.loading} rows={3} className="sm:col-span-2" />
          </div>
        </Section>

        <Section title={k.forms}>
          <div className="grid w-full gap-5 sm:grid-cols-2">
            <Field label={k.email} hint={k.emailHint}>
              <Input type="email" dir="ltr" leadingIcon="mail" placeholder={k.emailPh} />
            </Field>
            <Field label={k.password} error={k.passwordError}>
              <PasswordInput dir="ltr" showLabel={k.show} hideLabel={k.hide} defaultValue="abc" />
            </Field>
            <Field label={k.category}>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue placeholder={k.all} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{k.all}</SelectItem>
                  <SelectItem value="abayas">{k.abayas}</SelectItem>
                  <SelectItem value="bags">{k.bags}</SelectItem>
                  <SelectItem value="perfume">{k.perfume}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={k.notes}>
              <Textarea placeholder={k.notesPh} rows={2} className="min-h-9" />
            </Field>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2.5">
                <Checkbox id="gallery-vat" defaultChecked />
                <Label htmlFor="gallery-vat">{k.terms}</Label>
              </div>
              <div className="flex items-center gap-2.5">
                <Switch id="gallery-sync" />
                <Label htmlFor="gallery-sync">{k.autosync}</Label>
              </div>
            </div>
            <Field label={k.code}>
              <OtpInput value={otp} onChange={setOtp} digitLabel={k.digit} ofLabel={k.of} />
            </Field>
          </div>
        </Section>

        <Section title={k.tabsSection}>
          <Tabs defaultValue="stories" dir={dir} className="w-full">
            <TabsList>
              <TabsTrigger value="stories">{k.tabStories}</TabsTrigger>
              <TabsTrigger value="reels">{k.tabReels}</TabsTrigger>
            </TabsList>
            <TabsContent value="stories" className="text-muted-foreground">
              {k.tabStoriesBody}
            </TabsContent>
            <TabsContent value="reels" className="text-muted-foreground">
              {k.tabReelsBody}
            </TabsContent>
          </Tabs>
        </Section>

        <Section title={k.overlays}>
          <TooltipProvider delayDuration={300}>
            <Dialog>
              <DialogTrigger asChild>
                <Button>{k.openDialog}</Button>
              </DialogTrigger>
              <DialogContent closeLabel={k.cancel} dir={dir}>
                <DialogHeader>
                  <DialogTitle>{k.dialogTitle}</DialogTitle>
                  <DialogDescription>{k.dialogBody}</DialogDescription>
                </DialogHeader>
                <DialogBody>
                  <Field label={k.dialogTitle}>
                    <Input size="lg" defaultValue={k.tabStories} />
                  </Field>
                </DialogBody>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button>{k.cancel}</Button>
                  </DialogClose>
                  <Button variant="primary">{k.save}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
              {k.openConfirm}
            </Button>
            <ConfirmDialog
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
              title={k.confirmTitle}
              description={k.confirmBody}
              confirmLabel={k.confirmDelete}
              cancelLabel={k.cancel}
              onConfirm={() => setConfirmOpen(false)}
            />
            <Button variant="destructive" onClick={() => void dialog.confirm({ tone: 'danger', icon: 'logout', title: k.signOutTitle, description: k.signOutBody, confirmLabel: k.signOut, cancelLabel: k.stay, onConfirm: () => new Promise((r) => setTimeout(r, 900)) })}>
              {k.globalDanger}
            </Button>
            <Button onClick={() => void dialog.confirm({ tone: 'warning', title: k.leaveTitle, description: k.leaveBody, confirmLabel: k.leave, cancelLabel: k.keepEditing })}>{k.globalWarning}</Button>
            <Button onClick={() => void dialog.confirm({ tone: 'neutral', icon: 'play', title: k.publishTitle, description: k.publishBody, confirmLabel: k.publish, cancelLabel: k.cancel })}>{k.globalNeutral}</Button>
            <Sheet>
              <SheetTrigger asChild>
                <Button>{k.openSheet}</Button>
              </SheetTrigger>
              <SheetContent closeLabel={k.cancel} dir={dir} aria-describedby={undefined}>
                <SheetTitle>{k.sheetTitle}</SheetTitle>
              </SheetContent>
            </Sheet>
            <DropdownMenu dir={dir}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost">{k.openMenu}</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>{k.menuLabel}</DropdownMenuLabel>
                <DropdownMenuItem>{k.edit}</DropdownMenuItem>
                <DropdownMenuItem>{k.duplicate}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem tone="danger">{k.remove}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost">{k.tipTrigger}</Button>
              </TooltipTrigger>
              <TooltipContent>{k.tip}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Section>

        <Section title={k.themeSection}>
          <ThemeToggle lightLabel={k.toLight} darkLabel={k.toDark} onThemeChange={(t) => setDark(t === 'dark')} />
          <ThemeToggle lightLabel={k.toLight} darkLabel={k.toDark} showLabel onThemeChange={(t) => setDark(t === 'dark')} />
        </Section>
      </div>
      <Toaster key={locale} label={c.toaster} closeLabel={c.close} dir={dir} />
      <DialogHost dir={dir} />
    </div>
  );
}
