'use client';
import type { ContentItem } from '@slips/contracts';
import { useI18n } from '../../i18n/provider';
export const hasRetryableSlides = (item: ContentItem) => item.status === 'failed' && item.slides.some(s => s.status === 'failed' && s.failure_reason === 'processing_failed');
export function ContentStatusReason({ item }: { item: ContentItem }) {
  const m = useI18n().messages.content;
  const reason = item.status_reason;
  if (!reason) return null;
  const text = reason.code === 'no_placement' || reason.code === 'unsupported_format' ? m.statusReasons[reason.code] : [reason.kind ? m.statusReasons[reason.kind] : '', m.editor.slides.failures[reason.code]].filter(Boolean).join(' ');
  return <span role="status" className="text-small text-muted-foreground">{text}</span>;
}
