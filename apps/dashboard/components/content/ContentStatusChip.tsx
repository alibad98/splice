import type { ContentStatus } from '@slips/contracts';
import { Icon, StatusChip, type StatusChipProps } from '@slips/ui';
import type { Messages } from '../../i18n/messages';

type ChipLook = Pick<StatusChipProps, 'tone' | 'variant' | 'dot' | 'pulse'> & { archiveIcon?: boolean };

/** DESIGN.md chip per stored status (never recomputed here). The text label is always shown. */
export const CONTENT_CHIPS: Record<ContentStatus, ChipLook> = {
  draft: { tone: 'neutral' },
  processing: { tone: 'info', pulse: true },
  failed: { tone: 'danger' },
  scheduled: { tone: 'info' },
  published: { tone: 'success' },
  ended: { tone: 'neutral', variant: 'outline', dot: false },
  archived: { tone: 'neutral', variant: 'outline', dot: false, archiveIcon: true },
  deactivated: { tone: 'warning' },
};

export function ContentStatusChip({ status, labels }: { status: ContentStatus; labels: Messages['content']['statuses'] }) {
  const { archiveIcon, ...look } = CONTENT_CHIPS[status];
  return (
    <StatusChip {...look} {...(archiveIcon ? { icon: <Icon name="archive" /> } : {})}>
      <span data-status={status}>{labels[status]}</span>
    </StatusChip>
  );
}
