'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { CatalogSyncStatus } from '@slips/contracts';
import { Button, toast } from '@slips/ui';
import { useI18n } from '../../i18n/provider';
import { formatDate, formatRelativeTime } from '../../i18n/format';
import { isSyncActive, useRequestSync } from '../../lib/api/catalog';
import { ApiError } from '../../lib/api/fetch';
import { fill } from './format';

/** Re-render once a minute so "Last synced 5 minutes ago" stays true. */
function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Failure toasts already shown in this browser session, by run id: a run's failure is shown once, across reloads. */
const SHOWN_KEY = 'slips.catalog-sync.failure-shown';
function readShown(): string[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(SHOWN_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
/** Records the run as shown; false when it already was. */
function markShown(runId: string): boolean {
  const shown = readShown();
  if (shown.includes(runId)) return false;
  try {
    sessionStorage.setItem(SHOWN_KEY, JSON.stringify([...shown, runId].slice(-50)));
  } catch {
    // storage unavailable: the toast may show again after a reload
  }
  return true;
}

/** Fallback when a 429 carries no readable `Retry-After`. */
const RETRY_AFTER_FALLBACK_S = 60;

/**
 * Products page sync header: "Last synced {relative time}" (exact time in the store time zone on hover/focus) and the
 * "Sync products" button. The button stays pending (spinner, `aria-busy`, clicks ignored) from the click until the run
 * ends. Outcomes are toasts: "Products updated", a neutral "try again in N seconds" on a 429 (N from `Retry-After`), and
 * a failure toast with Retry that stays until dismissed, once per failed run (also for a run that failed while away). The API decides single-flight and the rate limit; this only reflects its answers.
 */
export function SyncHeader({ sync }: { sync: CatalogSyncStatus | undefined }) {
  const { locale, messages } = useI18n();
  const m = messages.products.sync;
  const now = useNow();
  const tipId = useId();
  const request = useRequestSync();
  const requestSync = useRef<() => void>(() => undefined);
  // Set synchronously on click, so a double click never sends two requests (state updates land a render later).
  const inFlight = useRef(false);

  requestSync.current = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    request.mutate(undefined, {
      onSettled: () => {
        inFlight.current = false;
      },
      onError: (err) => {
        if (err instanceof ApiError && err.status === 429) toast({ id: 'catalog-sync-too-soon', title: fill(m.tooSoon, { seconds: err.retryAfter ?? RETRY_AFTER_FALLBACK_S }) });
        else toast({ id: 'catalog-sync-request-failed', title: m.requestFailed, tone: 'danger' });
      },
    });
  };

  // Success: once, when a run we saw under way (or the first import) finishes.
  const previous = useRef(sync?.status);
  useEffect(() => {
    const was = previous.current;
    previous.current = sync?.status;
    if (sync?.status === 'succeeded' && (isSyncActive(was) || was === 'never')) toast({ id: `catalog-sync-updated-${sync.run_id ?? 'run'}`, title: m.updated, tone: 'success' });
  }, [sync, m]);

  // Failure: whenever the latest run is failed and its failure was not shown yet this session (live or on load).
  useEffect(() => {
    if (sync?.status !== 'failed' || !sync.run_id || !markShown(sync.run_id)) return;
    toast({ id: `catalog-sync-failed-${sync.run_id}`, title: m.failed, tone: 'danger', action: { label: m.retry, onClick: () => requestSync.current() } });
  }, [sync, m]);

  const busy = request.isPending || isSyncActive(sync?.status);
  const last = sync?.last_synced_at ? new Date(sync.last_synced_at) : null;

  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="sync-header">
      {sync ? (
        <p className="text-small text-muted-foreground">
          {last ? (
            <span className="group relative inline-block">
              <time dateTime={sync.last_synced_at!} tabIndex={0} aria-describedby={tipId} className="rounded-sm">
                {fill(m.lastSynced, { time: formatRelativeTime(last, locale, now) })}
              </time>
              <span
                id={tipId}
                role="tooltip"
                className="pointer-events-none absolute start-0 top-full z-10 mt-1 hidden rounded-sm bg-foreground px-2 py-1 whitespace-nowrap text-background group-focus-within:block group-hover:block"
              >
                <bdi className="tabular-nums">{formatDate(last, locale, { dateStyle: 'medium', timeStyle: 'short' })}</bdi>
              </span>
            </span>
          ) : (
            m.notSynced
          )}
        </p>
      ) : null}
      <Button variant="secondary" pending={busy} onClick={() => requestSync.current()}>
        {m.button}
      </Button>
    </div>
  );
}
