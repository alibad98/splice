'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import {
  CONTENT_CTA_URL_NOT_STORE_DOMAIN,
  CONTENT_PRODUCT_NOT_LINKABLE,
  CONTENT_SLIDE_ALT_REQUIRED,
  MEDIA_NOT_ATTACHABLE,
  SLIDE_ALT_MAX,
  type ContentItem,
  type ContentProductSummary,
  type MediaAsset,
} from '@slips/contracts';
import { Alert, Button, ErrorSummary, Icon, cn, toast } from '@slips/ui';
import { useI18n } from '../../../i18n/provider';
import { ApiError } from '../../../lib/api/fetch';
import { queryKeys } from '../../../lib/api/query-keys';
import { useCreateContent, useUpdateContent, useRetryContent, useContentItem } from '../../../lib/api/content';
import { fill } from '../../products/format';
import { useSession } from '../../session/SessionProvider';
import { LangLink } from '../../shell/LangLink';
import { ContentStatusReason, hasRetryableSlides } from '../ContentStatusReason';
import { ContentStatusChip } from '../ContentStatusChip';
import { contentHref } from '../ContentTable';
import { CtaCard } from './CtaCard';
import { FormatTitleCard } from './FormatTitleCard';
import { LivePreviewPanel } from './LivePreviewPanel';
import { ProductCard } from './ProductCard';
import { SlidesCard } from './SlidesCard';
import { EDITOR_FIELDS, editorSchema, fieldId, fromItem, newItemValues, patchOf, saveKey, slideAltId, toInput, type EditorErrorKey, type EditorValues } from './form';
import { useAutosave } from './use-autosave';
import { useLeaveGuard } from './use-leave-guard';
import { useUploads } from './use-uploads';

const PREVIEW_ID = 'content-preview';
const NO_DOMAINS: readonly string[] = [];

/** The save failed on a rule the form shows itself (the store-domain check), so no toast. */
class FieldRejected extends Error {}

/**
 * Create and edit one Story or Reel (Stories 3.3, 3.4, 3.6): format and title, slides, the linked product, CTA, and a saved-content preview. Drafts (and a new
 * item, once it has a title) autosave; other statuses save with "Save changes"; archived items are read-only. Files can
 * be dropped before the title: they upload at once and their slides are sent with the first create.
 * Without `item` the first save creates the Draft and the URL becomes `/content/{id}` without a remount.
 */
export function ContentEditor({ item }: { item?: ContentItem }) {
  const { messages } = useI18n();
  const m = messages.content.editor;
  const session = useSession();
  const domains = session?.state.status === 'signed-in' ? session.state.storeDomains : NO_DOMAINS;
  const queryClient = useQueryClient();
  const { mutateAsync: create } = useCreateContent();
  const { mutateAsync: update } = useUpdateContent();
  const uploads = useUploads();
  const retryProcessing = useRetryContent();

  const schema = useMemo(() => editorSchema(domains), [domains]);
  const [initialValues] = useState<EditorValues>(() => (item ? fromItem(item) : newItemValues(m.cta.picks.addToCart)));
  const form = useForm<EditorValues>({ resolver: zodResolver(schema), defaultValues: initialValues, mode: 'onTouched', reValidateMode: 'onChange' });
  const { getValues, handleSubmit, reset, setError, setValue, trigger, watch } = form;

  // The API's latest answer for this item; null until a new item is first saved.
  const [saved, setSaved] = useState<ContentItem | null>(item ?? null);
  const observed = useContentItem(item ? null : saved?.id ?? null);
  const incoming = item ?? observed.data;
  const savedRef = useRef(saved);
  const persisting = useRef(false);
  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);

  // A refetch brought a different version (changed elsewhere, or after a 409): show it.
  useEffect(() => {
    const prev = savedRef.current;
    const item = incoming;
    if (!item || persisting.current || item.updated_at <= (prev?.updated_at ?? '')) return;
    // A rejected live save must keep the merchant's whole pending edit available for correction/retry.
    const preserveLocalFields = prev?.status === 'published' && item.status === 'published' && saveKey(getValues()) !== saveKey(fromItem(prev));
    savedRef.current = item;
    setSaved(item);
    if (preserveLocalFields) return;
    const next = fromItem(item);
    // When only non-form fields changed (e.g. background status `processing -> draft` or `poster_url`), preserve any unsaved edits.
    if (prev && item.status !== 'archived' && saveKey(next) === saveKey(fromItem(prev))) return;
    // Keep rows of uploads that the item does not have yet (still uploading, or uploaded but not saved), after its slides.
    const savedAssets = new Set(item.slides.map((s) => s.media_asset_id));
    const pending = getValues('slides').filter((s) => uploads.uploads.has(s.key) && !(s.media_asset_id && savedAssets.has(s.media_asset_id)));
    reset({ ...next, slides: [...next.slides, ...pending] });
  }, [incoming, reset, getValues, uploads.uploads]);

  const values = watch();
  const currentKey = saveKey(values);
  const baselineKey = useMemo(() => saveKey(saved ? fromItem(saved) : initialValues), [saved, initialValues]);
  const dirty = currentKey !== baselineKey;
  const valid = schema.safeParse(values).success;

  // The linked product as last saved, or as picked from the search until the save answers.
  const [picked, setPicked] = useState<ContentProductSummary | null>(null);
  const product = !values.product_id
    ? null
    : saved?.product?.id === values.product_id
      ? saved.product
      : picked?.id === values.product_id
        ? picked
        : null;

  const status = saved?.status ?? 'draft';
  const readOnly = status === 'archived';
  const autosaves = status === 'draft' || status === 'processing';

  const onAssetProcessed = useCallback(
    (asset: MediaAsset) => {
      const current = savedRef.current;
      if (!current) return;
      const slides = current.slides.map((s) =>
        s.media_asset_id === asset.id
          ? { ...s, status: asset.status, failure_reason: asset.failure_reason, poster_url: asset.poster_url }
          : s,
      );
      const allProcessed = slides.length > 0 && slides.every((s) => s.status === 'processed');
      const nextStatus = current.status === 'processing' && allProcessed ? 'draft' : current.status;
      if (
        nextStatus !== current.status ||
        slides.some((s, i) => s.status !== current.slides[i]?.status || s.poster_url !== current.slides[i]?.poster_url)
      ) {
        const updated = { ...current, status: nextStatus, slides };
        savedRef.current = updated;
        setSaved(updated);
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.content.item(current.id) });
    },
    [queryClient],
  );

  const onSaveError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 422 && err.type === CONTENT_CTA_URL_NOT_STORE_DOMAIN) {
        setError('cta_url', { type: 'server', message: 'urlDomain' satisfies EditorErrorKey }, { shouldFocus: true });
        return new FieldRejected();
      }
      if (err instanceof ApiError && err.status === 422 && err.type === CONTENT_SLIDE_ALT_REQUIRED) {
        void trigger('slides');
        return new FieldRejected();
      }
      if (err instanceof ApiError && err.status === 422 && err.type === MEDIA_NOT_ATTACHABLE) {
        // A new slide's file failed its checks between upload and save: say so; the slides show it as Failed once polled.
        toast({ title: m.slides.notAttachable, tone: 'danger' });
        return err;
      }
      if (err instanceof ApiError && err.status === 422 && err.type === CONTENT_PRODUCT_NOT_LINKABLE) {
        // Reload a rejected link. Draft autosave returns to the saved product; explicit Published edits stay local
        // so the merchant can correct the combined edit and retry.
        toast({ title: m.product.deleted.title, tone: 'danger' });
        if (savedRef.current?.status !== 'published') setValue('product_id', savedRef.current?.product?.id ?? null, { shouldDirty: true });
        if (savedRef.current) void queryClient.invalidateQueries({ queryKey: queryKeys.content.item(savedRef.current.id) });
        return err;
      }
      if (err instanceof ApiError && (err.status === 409 || err.status === 404) && savedRef.current) {
        toast({ title: m.staleItem, tone: 'danger' });
        void queryClient.invalidateQueries({ queryKey: queryKeys.content.item(savedRef.current.id) });
      }
      return err;
    },
    [m.product.deleted.title, m.slides.notAttachable, m.staleItem, queryClient, setError, setValue, trigger],
  );

  /** Send the current values: POST the first time, then PATCH only what changed. */
  const persist = useCallback(async () => {
    const next = getValues();
    if (!schema.safeParse(next).success) throw new FieldRejected();
    const current = savedRef.current;
    persisting.current = true;
    try {
      if (!current) {
        const created = await create(toInput(next));
        savedRef.current = created;
        setSaved(created);
        // Same component, new address: no remount, no lost keystrokes.
        window.history.replaceState(window.history.state, '', `${contentHref(created.id)}${window.location.search}`);
        return;
      }
      const patch = patchOf(fromItem(current), next);
      if (Object.keys(patch).length === 0) return;
      const updated = await update({ id: current.id, patch });
      savedRef.current = updated;
      setSaved(updated);
    } catch (err) {
      throw onSaveError(err);
    } finally {
      persisting.current = false;
    }
  }, [create, getValues, onSaveError, schema, update]);

  const autosave = useAutosave({ enabled: autosaves && !readOnly, dirty, valid, changeKey: currentKey, run: persist });

  // Error summary: shown after a submit with errors, focused on each such submit, gone once they are fixed.
  const [submitCount, setSubmitCount] = useState(0);
  const errors = form.formState.errors;
  const summaryItems =
    submitCount > 0
      ? EDITOR_FIELDS.flatMap((f) => {
          if (f === 'slides') {
            // One entry per slide alt field with an error, in slide order.
            return values.slides.flatMap((slide, i) => {
              const key = errors.slides?.[i]?.alt_text?.message as EditorErrorKey | undefined;
              return key ? [{ id: slideAltId(slide), label: fill(m.errors[key], { n: i + 1, max: SLIDE_ALT_MAX }) }] : [];
            });
          }
          const key = errors[f]?.message as EditorErrorKey | undefined;
          return key ? [{ id: fieldId(f), label: fill(m.errors[key], { domain: domains[0] ?? '' }) }] : [];
        })
      : [];
  const onInvalid = () => setSubmitCount((n) => n + 1);

  const [savingChanges, setSavingChanges] = useState(false);
  const onSubmit = handleSubmit(async () => {
    if (autosaves) {
      await autosave.save();
      return;
    }
    setSavingChanges(true);
    try {
      await persist();
      toast({ title: m.changesSaved, tone: 'success' });
    } catch (err) {
      if (!(err instanceof FieldRejected) && !(err instanceof ApiError && (err.status === 409 || err.status === 404))) toast({ title: m.changesFailed, tone: 'danger' });
    } finally {
      setSavingChanges(false);
    }
  }, onInvalid);

  // Uploads still running count as unsaved work too.
  useLeaveGuard(!readOnly && (dirty || autosave.failed || uploads.active), m.leave);

  const [previewOpen, setPreviewOpen] = useState(false);
  const title = values.title;

  return (
    <FormProvider {...form}>
      <section className="flex flex-col gap-6">
        <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <LangLink href="/content" className="inline-flex items-center gap-1 self-start text-small text-muted-foreground hover:text-foreground hover:underline">
              <Icon name="arrow" className="size-3.5 rotate-180" />
              {m.back}
            </LangLink>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 dir="auto" className="min-w-0 truncate text-h1">
                {title || m.untitled[values.format]}
              </h1>
              <ContentStatusChip status={status} labels={messages.content.statuses} />
              {saved ? <ContentStatusReason item={saved} /> : null}
            </div>
          </div>
          {readOnly ? null : (
            <div className="flex flex-wrap items-center gap-3">
              {autosaves ? <SaveIndicator saving={autosave.saving} failed={autosave.failed} saved={Boolean(saved) && !dirty} onRetry={() => void autosave.save()} /> : null}
              <Button type="submit" form="content-editor-form" variant={autosaves ? 'secondary' : 'primary'} pending={autosaves ? autosave.saving : savingChanges} disabled={!autosaves && !dirty}>
                {autosaves ? m.saveDraft : m.saveChanges}
              </Button>
            </div>
          )}
        </header>

        {readOnly ? <Alert tone="info" description={m.archivedNote} /> : null}
        {saved?.status === 'failed' ? <div role="alert" className="flex items-center gap-3 rounded border border-destructive p-3">
          <span>{hasRetryableSlides(saved) ? m.slides.failures.processing_failed : m.replaceMedia}</span>
          <Button disabled={!hasRetryableSlides(saved)} pending={retryProcessing.isPending} onClick={() => retryProcessing.mutate(saved.id, { onSuccess: (item) => {
            savedRef.current = item; setSaved(item);
            for (const [key, held] of uploads.uploads) {
              if (held.asset && item.slides.some(s => s.media_asset_id === held.asset?.id && s.status === 'scanned')) uploads.setAsset(key, { ...held.asset, status: 'scanned', failure_reason: null, poster_url: null });
            }
          }, onError: () => toast({ title: m.changesFailed, tone: 'danger' }) })}>{messages.content.actions.retry}</Button>
        </div> : null}
        <ErrorSummary title={m.errors.summary} items={summaryItems} focusKey={submitCount} />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <form id="content-editor-form" noValidate onSubmit={(e) => void onSubmit(e)} className={cn('flex-col gap-6', previewOpen ? 'hidden lg:flex' : 'flex')}>
            <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-6">
              <FormatTitleCard autoFocusTitle={!item} />
              <label className="flex items-center gap-3"><input type="checkbox" role="switch" {...form.register('auto_publish')} />{m.autoPublish.label}</label>
              <p className="text-small text-muted-foreground">{m.autoPublish.hint}</p>
              <SlidesCard uploads={uploads} savedSlides={saved?.slides ?? []} readOnly={readOnly} onAssetProcessed={onAssetProcessed} />
              <ProductCard product={product} onPicked={setPicked} />
              <CtaCard domains={domains} />
            </fieldset>
          </form>
          <aside id={PREVIEW_ID} aria-label={m.preview.heading} className={cn('flex-col gap-3 lg:sticky lg:top-6', previewOpen ? 'flex' : 'hidden lg:flex')}>
            <h2 className="text-h3">{m.preview.heading}</h2>
            <LivePreviewPanel saved={saved} />
          </aside>
        </div>

        {/* Below lg the preview is one tap away: sticky on md, in flow on phones. */}
        <div className="flex justify-end md:sticky md:bottom-4 lg:hidden">
          <Button variant="secondary" aria-controls={PREVIEW_ID} aria-expanded={previewOpen} onClick={() => setPreviewOpen((o) => !o)} className="shadow-card">
            {previewOpen ? m.preview.hide : m.preview.show}
          </Button>
        </div>
      </section>
    </FormProvider>
  );
}

/** "Saving…" then "Saved"; a failed save offers Retry. Announced politely. */
function SaveIndicator({ saving, failed, saved, onRetry }: { saving: boolean; failed: boolean; saved: boolean; onRetry: () => void }) {
  const m = useI18n().messages.content.editor;
  return (
    <span role="status" className="inline-flex items-center gap-2 text-small font-medium">
      {saving ? (
        <span className="text-muted-foreground">{m.saving}</span>
      ) : failed ? (
        <>
          <span className="text-destructive-text">{m.saveFailed}</span>
          <Button size="sm" variant="ghost" onClick={onRetry}>
            {m.retry}
          </Button>
        </>
      ) : saved ? (
        <span className="inline-flex items-center gap-1 text-success-text">
          <Icon name="check" className="size-3.5" />
          {m.saved}
        </span>
      ) : null}
    </span>
  );
}
