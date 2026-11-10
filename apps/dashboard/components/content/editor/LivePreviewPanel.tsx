'use client';

import type { ContentItem } from '@slips/contracts';
import { Button, cn } from '@slips/ui';
import { useI18n } from '../../../i18n/provider';
import { useLivePreview } from './use-live-preview';

export function LivePreviewPanel({ saved }: { saved: ContentItem | null }) {
  const m = useI18n().messages.content.editor.preview;
  const preview = useLivePreview(saved);
  return <div className="flex flex-col items-center gap-3">
    <div data-testid="preview-frame" aria-busy={preview.loading} className="relative aspect-[9/16] w-full max-w-[18rem] overflow-hidden rounded-lg border-[6px] border-foreground bg-background shadow-card">
      <iframe ref={preview.iframe} src={preview.src} title={m.title} onError={preview.fail} className={cn('h-full w-full border-0', !saved && 'invisible')} />
      {!saved ? <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-small text-muted-foreground">{m.saveFirst}</div> : null}
      {saved && preview.skeleton && !preview.hasView && !preview.error ? <div aria-hidden="true" data-testid="preview-skeleton" className="absolute inset-0 flex animate-pulse flex-col justify-end gap-3 bg-muted p-4 motion-reduce:animate-none"><div className="h-6 w-3/4 rounded bg-background" /><div className="h-10 rounded bg-background" /></div> : null}
      {preview.error && !preview.hasView ? <div className="absolute inset-0 bg-background" /> : null}
    </div>
    <span role="status" aria-live="polite" className="sr-only">{preview.loading ? m.loading : ''}</span>
    {preview.error ? <div role="status" className="flex max-w-[18rem] flex-col items-center gap-2 text-center text-small"><p>{m.error}</p><Button size="sm" variant="secondary" onClick={preview.retry}>{m.retry}</Button></div> : null}
    <p className="max-w-[18rem] text-center text-small font-medium text-warning-text">{m.safety}</p>
  </div>;
}
