'use client';

import type { ReactNode } from 'react';
import { CONTENT_TABS, type ContentTab, type ContentTabCounts } from '@slips/contracts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@slips/ui';
import { useI18n } from '../../i18n/provider';
import { directionOf } from '../../i18n/config';

interface Props {
  tab: ContentTab;
  /** Unknown until the first list response arrives. */
  counts: ContentTabCounts | undefined;
  onTabChange: (tab: ContentTab) => void;
  children: ReactNode;
}

/** Status tabs (All, Published, Scheduled, Drafts) with their counts; the active tab's panel holds the list. */
export function ContentTabs({ tab, counts, onTabChange, children }: Props) {
  const { locale, messages } = useI18n();
  const m = messages.content;
  return (
    <Tabs value={tab} onValueChange={(v) => onTabChange(v as ContentTab)} dir={directionOf(locale)} activationMode="manual">
      <TabsList aria-label={m.tabsLabel} className="max-w-full justify-start overflow-x-auto">
        {CONTENT_TABS.map((t) => (
          <TabsTrigger key={t} value={t} className="gap-1.5">
            {m.tabs[t]}
            {counts ? (
              <bdi data-testid={`count-${t}`} className="rounded-pill bg-background/70 px-1.5 text-[11px] leading-4 tabular-nums">
                {counts[t]}
              </bdi>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={tab} className="mt-4">
        {children}
      </TabsContent>
    </Tabs>
  );
}
