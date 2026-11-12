'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Drafts save this long after the last change (EXPERIENCE.md: ~1 s). */
export const AUTOSAVE_DELAY_MS = 1_000;

interface Options {
  /** Autosave only Drafts (and a new item); other statuses save explicitly. */
  enabled: boolean;
  /** The form differs from what the API last answered. */
  dirty: boolean;
  /** An invalid form never saves. */
  valid: boolean;
  /** Changes whenever the values change, so the timer restarts after every edit. */
  changeKey: string;
  /** Saves the current values; rejects when the save failed. */
  run: () => Promise<unknown>;
  delay?: number;
}

/**
 * Debounced autosave: `delay` after the last valid change, one save at a time. A change made while a save is in flight
 * is saved after it. A failed save waits for the next change or an explicit `save()` (the Retry button).
 */
export function useAutosave({ enabled, dirty, valid, changeKey, run, delay = AUTOSAVE_DELAY_MS }: Options) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const save = useCallback(async (): Promise<boolean> => {
    // Waiting for a previous request is not enough: it may contain older form values.
    // Serialize, then persist the latest values before callers can publish.
    while (inFlight.current) await inFlight.current;
    const request = (async () => {
      setSaving(true);
      try {
        await runRef.current();
        setFailed(false);
        return true;
      } catch {
        setFailed(true);
        return false;
      } finally {
        setSaving(false);
      }
    })();
    inFlight.current = request;
    const ok = await request;
    if (inFlight.current === request) inFlight.current = null;
    return ok;
  }, []);

  useEffect(() => {
    if (!enabled || !dirty || !valid) return;
    const id = setTimeout(() => void save(), delay);
    return () => clearTimeout(id);
  }, [enabled, dirty, valid, changeKey, delay, save]);

  return { saving, failed, save };
}
