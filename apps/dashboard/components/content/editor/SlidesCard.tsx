'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import { MEDIA_IMPORT_URL_MAX, MEDIA_KINDS, MEDIA_LIMITS, SLIDES_MAX, SLIDE_ALT_MAX, type ContentSlide, type MediaAsset, type MediaFailureReason, type MediaKind } from '@slips/contracts';
import { Alert, Button, Card, CardTitle, DropZone, Field, Icon, Input, Progress, StatusChip, cn, type StatusTone } from '@slips/ui';
import { useI18n } from '../../../i18n/provider';
import type { Messages } from '../../../i18n/messages';
import { MEDIA_IMPORT_POLL_MAX_MS, isPendingAssetStatus, useMediaAssetStatus, usePosterSrc } from '../../../lib/api/media';
import { fill } from '../../products/format';
import { fieldId, slideAltId, type EditorErrorKey, type EditorValues, type SlideValue } from './form';
import { checkLink, inferLinkKind } from './media-link';
import { precheckFile, type PrecheckReason } from './media-precheck';
import type { NewUpload, UploadState, Uploads } from './use-uploads';

type SlidesCopy = Messages['content']['editor']['slides'];

const MB = 1024 * 1024;
const ACCEPT = [...MEDIA_LIMITS.image.content_types, ...MEDIA_LIMITS.video.content_types, '.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mov', '.webm'].join(',');

/** The copy values every limit message can use. */
const LIMIT_VALUES = {
  max: SLIDES_MAX,
  imageMb: MEDIA_LIMITS.image.max_bytes / MB,
  videoMb: MEDIA_LIMITS.video.max_bytes / MB,
  seconds: MEDIA_LIMITS.video.max_duration_seconds,
  imagePx: MEDIA_LIMITS.image.min_short_side,
  videoPx: MEDIA_LIMITS.video.min_short_side,
};

/** The limit a refusal names. */
const reasonValues = (reason: PrecheckReason | 'full'): Record<string, number> => {
  switch (reason) {
    case 'imageSize':
      return { mb: LIMIT_VALUES.imageMb };
    case 'videoSize':
      return { mb: LIMIT_VALUES.videoMb };
    case 'videoDuration':
      return { seconds: LIMIT_VALUES.seconds };
    case 'imageResolution':
      return { px: LIMIT_VALUES.imagePx };
    case 'videoResolution':
      return { px: LIMIT_VALUES.videoPx };
    case 'full':
      return { max: SLIDES_MAX };
    default:
      return {};
  }
};

let localKeys = 0;
const newKey = () => `local-${Date.now().toString(36)}-${(localKeys += 1)}`;

/** True when focus sits in another text-like field, so a finished upload must not steal it. */
const focusInField = (): boolean => {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return false;
  return el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && el.type !== 'file') || el.getAttribute('role') === 'combobox';
};

type View =
  | { state: 'waiting' }
  | { state: 'uploading'; percent: number }
  | { state: 'importing' }
  | { state: 'processing' }
  | { state: 'ready' }
  | { state: 'failed'; message: string; canRetry: boolean };

const CHIP: Record<View['state'], { tone: StatusTone; pulse?: boolean }> = {
  waiting: { tone: 'neutral' },
  uploading: { tone: 'info' },
  importing: { tone: 'info', pulse: true },
  processing: { tone: 'info', pulse: true },
  ready: { tone: 'success' },
  failed: { tone: 'danger' },
};

/**
 * The slides (Story 3.6): a multi-file drop zone with a browser pre-check, an "Add from a link" field (Story 3.7), the
 * ordered slide list with thumbs, per-file upload or import state, alt text, Move earlier/later, drag (desktop) and Remove. Order changes are announced ("Slide 2 of 3")
 * and focus stays on the moved slide. The list is the form's `slides`; uploads live in `uploads`.
 */
export function SlidesCard({
  uploads,
  savedSlides,
  readOnly,
  onAssetProcessed,
}: {
  uploads: Uploads;
  savedSlides: readonly ContentSlide[];
  readOnly: boolean;
  onAssetProcessed?: (asset: MediaAsset) => void;
}) {
  const { messages } = useI18n();
  const m = messages.content.editor;
  const s = m.slides;
  const { control, getValues, setValue, trigger, formState } = useFormContext<EditorValues>();
  const slides = useWatch({ control, name: 'slides' });

  const [announcement, setAnnouncement] = useState('');
  const [rejections, setRejections] = useState<string[]>([]);
  const pendingFocus = useRef<(() => HTMLElement | null) | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const zoneButton = () => document.querySelector<HTMLElement>(`#${fieldId('slides')}-zone button`);

  useLayoutEffect(() => {
    const target = pendingFocus.current?.();
    if (pendingFocus.current && target) {
      pendingFocus.current = null;
      target.focus();
    }
  });

  const announce = useCallback((text: string) => {
    // Re-announce identical text: clear first, then set.
    setAnnouncement('');
    window.setTimeout(() => setAnnouncement(text), 30);
  }, []);

  const write = useCallback(
    (next: SlideValue[]) => {
      setValue('slides', next, { shouldDirty: true });
      if (formState.errors.slides) void trigger('slides');
    },
    [formState.errors.slides, setValue, trigger],
  );

  const onFiles = async (files: File[]) => {
    const checked = await Promise.all(files.map(async (file) => ({ file, result: await precheckFile(file) })));
    const messagesOut: string[] = [];
    let room = SLIDES_MAX - getValues('slides').length;
    const accepted: NewUpload[] = [];
    for (const { file, result } of checked) {
      if (!result.ok) {
        const dimensions: Record<string, number> = result.reason === 'imageResolution' || result.reason === 'videoResolution'
          ? { width: result.width, height: result.height } : {};
        messagesOut.push(fill(s.rejected[result.reason], { file: file.name, ...reasonValues(result.reason), ...dimensions }));
        continue;
      }
      if (room <= 0) {
        messagesOut.push(fill(s.rejected.full, { file: file.name, ...reasonValues('full') }));
        continue;
      }
      room -= 1;
      accepted.push({ key: newKey(), source: { type: 'file', file, contentType: result.contentType }, kind: result.kind });
    }
    setRejections(messagesOut);
    if (accepted.length === 0) return;
    write([...getValues('slides'), ...accepted.map((a) => ({ key: a.key, media_asset_id: null, kind: a.kind, alt_text: '', source_url: null }))]);
    uploads.add(accepted);
  };

  /** A link becomes a slide right away (Importing); the API import runs in the upload queue. */
  const onLink = (url: string, kind: MediaKind) => {
    const list = getValues('slides');
    if (list.length >= SLIDES_MAX) return;
    const key = newKey();
    write([...list, { key, media_asset_id: null, kind, alt_text: '', source_url: url }]);
    uploads.add([{ key, source: { type: 'link', url }, kind }]);
    announce(fill(s.linkAdded, { n: list.length + 1 }));
  };

  const move = (index: number, to: number, via: 'earlier' | 'later' | 'drag') => {
    const list = [...getValues('slides')];
    if (to < 0 || to >= list.length || to === index) return;
    const [row] = list.splice(index, 1);
    list.splice(to, 0, row!);
    write(list);
    announce(fill(s.position, { n: to + 1, total: list.length }));
    if (via === 'drag') return;
    // Focus the same button on the moved slide; at an end (that button is disabled) the other one.
    const atEnd = via === 'earlier' ? to === 0 : to === list.length - 1;
    const which = atEnd ? (via === 'earlier' ? 'later' : 'earlier') : via;
    pendingFocus.current = () => listRef.current?.querySelector<HTMLElement>(`[data-slide-key="${row!.key}"] [data-move="${which}"]`) ?? null;
  };

  const remove = (index: number) => {
    const list = [...getValues('slides')];
    const [row] = list.splice(index, 1);
    if (!row) return;
    uploads.remove(row.key);
    write(list);
    announce(s.removed);
    const next = list[index] ?? list[index - 1];
    pendingFocus.current = () =>
      (next ? listRef.current?.querySelector<HTMLElement>(`[data-slide-key="${next.key}"] [data-remove]`) : null) ?? zoneButton();
  };

  // Drag and drop (desktop): native HTML5, one slide at a time. Buttons do the same everywhere.
  const [dragKey, setDragKey] = useState<string | null>(null);
  const onDragStart = (e: DragEvent<HTMLLIElement>, key: string) => {
    setDragKey(key);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', key);
  };
  const onDragOver = (e: DragEvent<HTMLLIElement>) => {
    if (!dragKey) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const onDrop = (e: DragEvent<HTMLLIElement>, targetIndex: number) => {
    if (!dragKey) return;
    e.preventDefault();
    const from = getValues('slides').findIndex((r) => r.key === dragKey);
    setDragKey(null);
    if (from >= 0) move(from, targetIndex, 'drag');
  };

  // A finished upload: the row gets its asset (unless inspection already failed it) and an image's alt field takes focus.
  const onUploaded = useCallback(
    (key: string, asset: MediaAsset) => {
      const list = getValues('slides');
      const index = list.findIndex((r) => r.key === key);
      if (index < 0) return;
      const row = list[index]!;
      const next = { ...row, media_asset_id: asset.status === 'failed' ? null : asset.id };
      setValue(`slides.${index}`, next, { shouldDirty: true });
      if (next.media_asset_id && row.kind === 'image' && !focusInField()) {
        pendingFocus.current = () => document.getElementById(slideAltId(next));
      }
    },
    [getValues, setValue],
  );
  const { bind } = uploads;
  useEffect(() => {
    bind(onUploaded);
  }, [bind, onUploaded]);

  /** An unsaved asset that failed inspection is kept as a local Failed row and never sent. */
  const onAssetFailed = useCallback(
    (key: string, asset: MediaAsset) => {
      uploads.setAsset(key, asset);
      onAssetProcessed?.(asset);
      if (savedSlides.some((x) => x.media_asset_id === asset.id)) return;
      const list = getValues('slides');
      const index = list.findIndex((r) => r.key === key);
      if (index >= 0 && list[index]!.media_asset_id === asset.id) setValue(`slides.${index}.media_asset_id`, null, { shouldDirty: true });
    },
    [getValues, savedSlides, setValue, uploads, onAssetProcessed],
  );

  /** When a polled asset finishes processing, update the held upload asset and notify the editor so item status refreshes (Story 3.8). */
  const onProcessed = useCallback(
    (key: string, asset: MediaAsset) => {
      uploads.setAsset(key, asset);
      onAssetProcessed?.(asset);
    },
    [onAssetProcessed, uploads],
  );

  // The held file or link again. After a reload only an imported slide can retry: a new import of its link swaps the asset.
  const retry = (row: SlideValue) => {
    if (uploads.retry(row.key) || !row.source_url) return;
    uploads.add([{ key: row.key, source: { type: 'link', url: row.source_url }, kind: row.kind }]);
  };

  const full = slides.length >= SLIDES_MAX;
  const savedByAsset = new Map(savedSlides.map((x) => [x.media_asset_id, x] as const));

  return (
    <Card>
      <CardTitle>{s.heading}</CardTitle>
      <p className="-mt-2 text-small text-muted-foreground">{fill(s.intro, LIMIT_VALUES)}</p>
      <div id={`${fieldId('slides')}-zone`}>
        <DropZone
          onFiles={(files) => void onFiles(files)}
          title={s.dropTitle}
          hint={fill(s.dropHint, LIMIT_VALUES)}
          buttonLabel={s.choose}
          accept={ACCEPT}
          multiple
          disabled={readOnly || full}
          disabledReason={full && !readOnly ? fill(s.full, LIMIT_VALUES) : undefined}
          inputId={fieldId('slides')}
        />
      </div>
      <LinkForm copy={s} disabled={readOnly || full} onAdd={onLink} />
      {rejections.length > 0 ? (
        <Alert
          tone="warning"
          title={s.rejected.title}
          description={
            <ul className="flex flex-col gap-0.5">
              {rejections.map((r, i) => (
                <li key={i} dir="auto">
                  {r}
                </li>
              ))}
            </ul>
          }
          onDismiss={() => setRejections([])}
          dismissLabel={s.rejected.dismiss}
        >
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={readOnly || full}
            onClick={() => (document.getElementById(fieldId('slides')) as HTMLInputElement | null)?.click()}
          >
            {s.rejected.replace}
          </Button>
        </Alert>
      ) : null}
      {slides.length > 0 ? (
        <ol ref={listRef} aria-label={s.listLabel} className="flex flex-col gap-3">
          {slides.map((row, index) => (
            <SlideItem
              key={row.key}
              row={row}
              index={index}
              total={slides.length}
              upload={uploads.uploads.get(row.key) ?? null}
              saved={row.media_asset_id ? (savedByAsset.get(row.media_asset_id) ?? null) : null}
              readOnly={readOnly}
              dragging={dragKey === row.key}
              copy={s}
              errorText={(key) => fill(m.errors[key], { n: index + 1, max: SLIDE_ALT_MAX })}
              onMove={(to, via) => move(index, to, via)}
              onRemove={() => remove(index)}
              onRetry={() => retry(row)}
              onAssetFailed={onAssetFailed}
              onAssetProcessed={onProcessed}
              onDragStart={(e) => onDragStart(e, row.key)}
              onDragOver={onDragOver}
              onDrop={(e) => onDrop(e, index)}
              onDragEnd={() => setDragKey(null)}
            />
          ))}
        </ol>
      ) : null}
      <p aria-live="polite" aria-atomic="true" data-slot="slides-announcer" className="sr-only">
        {announcement}
      </p>
    </Card>
  );
}

const failureMessage = (copy: SlidesCopy, reason: MediaFailureReason | null): string => (reason ? copy.failures[reason] : copy.failures.inspection_failed);

/**
 * The row's state: the upload (or the import request) while it runs, then the asset's status (polled while it is being
 * imported or waits for inspection). A failed asset can retry while its file is held or when it came from a link.
 */
const NO_REUPLOAD_REASONS: readonly (MediaFailureReason | null)[] = ['below_min_resolution', 'over_duration', 'no_video_track', 'corrupt', 'malware', 'type_not_allowed', 'type_mismatch'];

function viewOf(copy: SlidesCopy, upload: UploadState | null, asset: Pick<MediaAsset, 'status' | 'failure_reason'> | null, sourceUrl: string | null): View {
  const link = upload ? upload.source.type === 'link' : Boolean(sourceUrl);
  if (upload?.phase === 'waiting') return link ? { state: 'importing' } : { state: 'waiting' };
  if (upload?.phase === 'uploading') return link ? { state: 'importing' } : { state: 'uploading', percent: Math.round(upload.progress * 100) };
  if (upload?.phase === 'error') {
    const e = upload.error;
    const rejected = link ? copy.failures.linkRejected : copy.failures.rejected;
    const message = e?.kind === 'throttled' ? fill(copy.failures.throttled, { minutes: e.minutes }) : e?.kind === 'rejected' ? rejected : copy.failures.network;
    return { state: 'failed', message, canRetry: true };
  }
  if (!asset) return link ? { state: 'importing' } : { state: 'processing' };
  if (asset.status === 'failed') return { state: 'failed', message: failureMessage(copy, asset.failure_reason), canRetry: !NO_REUPLOAD_REASONS.includes(asset.failure_reason) && (Boolean(upload) || Boolean(sourceUrl)) };
  if (asset.status === 'importing') return { state: 'importing' };
  return asset.status === 'processed' ? { state: 'ready' } : { state: 'processing' };
}

/**
 * "Add from a link" (Story 3.7): the link and, when its path does not tell the kind, a required Image/Video choice. The
 * link is checked as the API does (http/https, port 80/443, no user info) before it becomes a slide. Not a nested form
 * (the editor is one): Enter in the field adds the link.
 */
function LinkForm({ copy, disabled, onAdd }: { copy: SlidesCopy; disabled: boolean; onAdd: (url: string, kind: MediaKind) => void }) {
  const id = useId();
  const inputId = `${id}-link`;
  const [value, setValue] = useState('');
  const [choice, setChoice] = useState<MediaKind | null>(null);
  const [error, setError] = useState<'invalid' | 'kind' | null>(null);
  const parsed = checkLink(value);
  const inferred = parsed ? inferLinkKind(parsed) : null;
  const needsKind = parsed !== null && inferred === null;

  const submit = (e: KeyboardEvent | MouseEvent) => {
    e.preventDefault();
    if (disabled) return;
    if (!parsed) return setError('invalid');
    const kind = inferred ?? choice;
    if (!kind) return setError('kind');
    onAdd(parsed.href, kind);
    setValue('');
    setChoice(null);
    setError(null);
  };

  const errorText = error === 'invalid' ? copy.linkInvalid : error === 'kind' ? copy.linkKindRequired : undefined;
  return (
    <div className="flex flex-col gap-2" data-slot="slides-link">
      <Field label={copy.linkLabel} htmlFor={inputId} hint={copy.linkHint} error={errorText}>
        <div className="flex gap-2">
          <Input
            id={inputId}
            type="url"
            inputMode="url"
            dir="ltr"
            autoComplete="off"
            placeholder={copy.linkPlaceholder}
            maxLength={MEDIA_IMPORT_URL_MAX}
            value={value}
            disabled={disabled}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit(e);
            }}
          />
          <Button type="button" variant="secondary" disabled={disabled} onClick={submit}>
            {copy.linkAdd}
          </Button>
        </div>
      </Field>
      {needsKind ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-small font-semibold text-foreground">{copy.linkKind}</legend>
          <div className="flex flex-wrap gap-4">
            {MEDIA_KINDS.map((kind) => (
              <label key={kind} className="inline-flex cursor-pointer items-center gap-2 text-small">
                <input
                  type="radio"
                  name={`${id}-kind`}
                  value={kind}
                  checked={choice === kind}
                  disabled={disabled}
                  onChange={() => {
                    setChoice(kind);
                    if (error === 'kind') setError(null);
                  }}
                  className="size-4 accent-foreground"
                />
                {copy.kinds[kind]}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}

interface SlideItemProps {
  row: SlideValue;
  index: number;
  total: number;
  upload: UploadState | null;
  saved: ContentSlide | null;
  readOnly: boolean;
  dragging: boolean;
  copy: SlidesCopy;
  errorText: (key: EditorErrorKey) => string;
  onMove: (to: number, via: 'earlier' | 'later') => void;
  onRemove: () => void;
  onRetry: () => void;
  onAssetFailed: (key: string, asset: MediaAsset) => void;
  onAssetProcessed: (key: string, asset: MediaAsset) => void;
  onDragStart: (e: DragEvent<HTMLLIElement>) => void;
  onDragOver: (e: DragEvent<HTMLLIElement>) => void;
  onDrop: (e: DragEvent<HTMLLIElement>) => void;
  onDragEnd: () => void;
}

function SlideItem({ row, index, total, upload, saved, readOnly, dragging, copy, errorText, onMove, onRemove, onRetry, onAssetFailed, onAssetProcessed, ...drag }: SlideItemProps) {
  const { control } = useFormContext<EditorValues>();
  const n = index + 1;
  const [mountedAt] = useState(() => Date.now());

  // The asset as last known: polled, else from the upload, else from the saved item.
  const known = saved?.status === 'scanned' && upload?.asset?.status === 'failed' ? saved : upload?.asset ?? saved ?? null;
  const [attempt, setAttempt] = useState(() => ({ status: known?.status, since: upload?.completedAt ?? mountedAt }));
  if (attempt.status !== known?.status) setAttempt({ status: known?.status, since: isPendingAssetStatus(known?.status) && !isPendingAssetStatus(attempt.status) ? Date.now() : attempt.since });
  const sourceUrl = row.source_url ?? saved?.source_url ?? null;
  const polled = useMediaAssetStatus(row.media_asset_id, {
    enabled: isPendingAssetStatus(known?.status),
    since: attempt.since,
    ...(sourceUrl ? { maxMs: MEDIA_IMPORT_POLL_MAX_MS } : {}),
  });
  const asset = polled.data && polled.data.id === row.media_asset_id && polled.dataUpdatedAt >= attempt.since ? polled.data : (known as Pick<MediaAsset, 'status' | 'failure_reason' | 'poster_url'> | null);
  const failedId = asset === polled.data && polled.data?.status === 'failed' ? polled.data.id : null;
  useEffect(() => {
    if (failedId && polled.data) onAssetFailed(row.key, polled.data);
  }, [failedId]);
  const processedId = asset === polled.data && polled.data?.status === 'processed' ? polled.data.id : null;
  useEffect(() => {
    if (processedId && polled.data && saved?.status !== 'processed') onAssetProcessed(row.key, polled.data);
  }, [processedId, saved?.status]);

  const resolvedPosterUrl = usePosterSrc(asset?.poster_url ?? saved?.poster_url ?? null);

  const view = viewOf(copy, upload, row.media_asset_id || upload ? asset : null, sourceUrl);
  const chip = CHIP[view.state];
  const label =
    view.state === 'uploading'
      ? fill(copy.states.uploading, { percent: view.percent })
      : view.state === 'failed'
        ? copy.states.failed
        : copy.states[view.state];
  const altLabel = fill(copy.alt, { n });

  return (
    <li
      data-slide-key={row.key}
      draggable={!readOnly}
      onDragStart={drag.onDragStart}
      onDragOver={drag.onDragOver}
      onDrop={drag.onDrop}
      onDragEnd={drag.onDragEnd}
      className={cn('flex gap-3 rounded-md border border-border bg-background p-3', dragging && 'opacity-50', view.state === 'failed' && 'border-destructive/40')}
    >
      <span className="hidden shrink-0 cursor-grab self-center text-muted-foreground md:inline-flex" title={fill(copy.drag, { n })} aria-hidden="true">
        <Icon name="grip" className="size-4" />
      </span>
      <SlideThumb kind={row.kind} n={n} previewUrl={upload?.previewUrl ?? null} posterUrl={resolvedPosterUrl} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-small font-semibold">{fill(copy.slideLabel, { n })}</span>
          <span className="text-small text-muted-foreground">{copy.kinds[row.kind]}</span>
          <StatusChip tone={chip.tone} pulse={chip.pulse}>
            <span data-slide-state={view.state}>{label}</span>
          </StatusChip>
        </div>
        {view.state === 'uploading' ? <Progress value={view.percent} label={fill(copy.slideLabel, { n })} valueText={`${view.percent}%`} /> : null}
        {view.state === 'failed' ? (
          <p className="text-small text-destructive-text" role="alert">
            {view.message}
            {!view.canRetry && asset?.failure_reason !== 'processing_failed' && !NO_REUPLOAD_REASONS.includes(asset?.failure_reason ?? null) ? ` ${copy.failures.noFile}` : null}
          </p>
        ) : null}
        <Controller
          name={`slides.${index}.alt_text`}
          control={control}
          render={({ field, fieldState }) => {
            const key = fieldState.error?.message as EditorErrorKey | undefined;
            return (
              <Field label={altLabel} htmlFor={slideAltId(row)} error={key ? errorText(key) : undefined} hint={row.kind === 'image' ? copy.altHint : copy.altVideoHint}>
                <Input dir="auto" autoComplete="off" maxLength={SLIDE_ALT_MAX + 50} {...field} />
              </Field>
            );
          }}
        />
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" data-move="earlier" aria-label={fill(copy.moveEarlier, { n })} disabled={readOnly || index === 0} onClick={() => onMove(index - 1, 'earlier')}>
            <Icon name="arrow-up" className="size-4" />
          </Button>
          <Button size="sm" variant="ghost" data-move="later" aria-label={fill(copy.moveLater, { n })} disabled={readOnly || index === total - 1} onClick={() => onMove(index + 1, 'later')}>
            <Icon name="arrow-down" className="size-4" />
          </Button>
          <Button size="sm" variant="ghost" data-remove aria-label={fill(copy.remove, { n })} disabled={readOnly} onClick={onRemove}>
            <Icon name="trash" className="size-4" />
          </Button>
        </div>
        {view.state === 'failed' && view.canRetry && !(saved && asset?.failure_reason === 'processing_failed') && !readOnly ? (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            <Icon name="retry" className="size-3.5" />
            {copy.retry}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** 9:16 thumb: the local file during the upload session, else the processed poster/web image (Story 3.8), else the kind icon with the slide number. */
function SlideThumb({ kind, n, previewUrl, posterUrl }: { kind: SlideValue['kind']; n: number; previewUrl: string | null; posterUrl?: string | null }) {
  return (
    <span data-slide-thumb className="relative flex aspect-[9/16] w-12 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted text-muted-foreground">
      {previewUrl && kind === 'image' ? (
        <img src={previewUrl} alt="" className="size-full object-cover" />
      ) : previewUrl ? (
        <video src={previewUrl} muted playsInline preload="metadata" className="size-full object-cover" aria-hidden="true" />
      ) : posterUrl ? (
        <img src={posterUrl} alt="" className="size-full object-cover" />
      ) : (
        <span className="flex flex-col items-center gap-0.5" aria-hidden="true">
          <Icon name={kind} className="size-4" />
          <span className="text-small tabular-nums">{n}</span>
        </span>
      )}
    </span>
  );
}
