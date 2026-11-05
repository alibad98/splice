'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { CONTENT_CTA_URL_NOT_STORE_DOMAIN, type ContentItem } from '@slips/contracts';
import { Alert, Button, ErrorSummary, Icon, cn, toast } from '@slips/ui';
import { useI18n } from '../../../i18n/provider';
import { ApiError } from '../../../lib/api/fetch';
import { queryKeys } from '../../../lib/api/query-keys';
import { useCreateContent, useUpdateContent } from '../../../lib/api/content';
import { fill } from '../../products/format';
import { useSession } from '../../session/SessionProvider';
import { LangLink } from '../../shell/LangLink';
import { ContentStatusChip } from '../ContentStatusChip';
import { contentHref } from '../ContentTable';
import { CtaCard } from './CtaCard';
import { FormatTitleCard } from './FormatTitleCard';
import { PreviewPlaceholder } from './PreviewPlaceholder';
import { EDITOR_FIELDS, editorSchema, fieldId, fromItem, newItemValues, patchOf, saveKey, toInput, type EditorErrorKey, type EditorValues } from './form';
import { useAutosave } from './use-autosave';
import { useLeaveGuard } from './use-leave-guard';

const PREVIEW_ID = 'content-preview';
const NO_DOMAINS: readonly string[] = [];

/** The save failed on a rule the form shows itself (the store-domain check), so no toast. */
class FieldRejected extends Error {}

/**
 * Create and edit one Story or Reel (Story 3.3): format and title, CTA, and a preview placeholder. Drafts (and a new
 * item, once it has a title) autosave; other statuses save with "Save changes"; archived items are read-only.
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

  const schema = useMemo(() => editorSchema(domains), [domains]);
  const [initialValues] = useState<EditorValues>(() => (item ? fromItem(item) : newItemValues(m.cta.picks.addToCart)));
  const form = useForm<EditorValues>({ resolver: zodResolver(schema), defaultValues: initialValues, mode: 'onTouched', reValidateMode: 'onChange' });
  const { getValues, handleSubmit, reset, setError, watch } = form;

  // The API's latest answer for this item; null until a new item is first saved.
  const [saved, setSaved] = useState<ContentItem | null>(item ?? null);
  const savedRef = useRef(saved);
  const persisting = useRef(false);
  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);

  // A refetch brought a different version (changed elsewhere, or after a 409): show it.
  useEffect(() => {
    if (!item || persisting.current || item.updated_at === savedRef.current?.updated_at) return;
    savedRef.current = item;
    setSaved(item);
    reset(fromItem(item));
  }, [item, reset]);

  const values = watch();
  const currentKey = saveKey(values);
  const baselineKey = useMemo(() => saveKey(saved ? fromItem(saved) : initialValues), [saved, initialValues]);
  const dirty = currentKey !== baselineKey;
  const valid = schema.safeParse(values).success;

  const status = saved?.status ?? 'draft';
  const readOnly = status === 'archived';
  const autosaves = status === 'draft';

  const onSaveError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 422 && err.type === CONTENT_CTA_URL_NOT_STORE_DOMAIN) {
        setError('cta_url', { type: 'server', message: 'urlDomain' satisfies EditorErrorKey }, { shouldFocus: true });
        return new FieldRejected();
      }
      if (err instanceof ApiError && (err.status === 409 || err.status === 404) && savedRef.current) {
        toast({ title: m.staleItem, tone: 'danger' });
        void queryClient.invalidateQueries({ queryKey: queryKeys.content.item(savedRef.current.id) });
      }
      return err;
    },
    [m.staleItem, queryClient, setError],
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

  useLeaveGuard(!readOnly && (dirty || autosave.failed), m.leave);

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
        <ErrorSummary title={m.errors.summary} items={summaryItems} focusKey={submitCount} />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <form id="content-editor-form" noValidate onSubmit={(e) => void onSubmit(e)} className={cn('flex-col gap-6', previewOpen ? 'hidden lg:flex' : 'flex')}>
            <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-6">
              <FormatTitleCard autoFocusTitle={!item} />
              <CtaCard domains={domains} />
            </fieldset>
          </form>
          <aside id={PREVIEW_ID} aria-label={m.preview.heading} className={cn('flex-col gap-3 lg:sticky lg:top-6', previewOpen ? 'flex' : 'hidden lg:flex')}>
            <h2 className="text-h3">{m.preview.heading}</h2>
            <PreviewPlaceholder />
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
