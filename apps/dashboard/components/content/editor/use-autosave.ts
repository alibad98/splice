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
  const [rerun, setRerun] = useState(0);
  const inFlight = useRef(false);
  const again = useRef(false);
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const save = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) {
      again.current = true;
      return false;
    }
    inFlight.current = true;
    setSaving(true);
    let ok = false;
    try {
      await runRef.current();
      ok = true;
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
      setSaving(false);
      if (again.current) {
        again.current = false;
        setRerun((n) => n + 1);
      }
    }
    return ok;
  }, []);

  useEffect(() => {
    if (!enabled || !dirty || !valid) return;
    const id = setTimeout(() => void save(), delay);
    return () => clearTimeout(id);
  }, [enabled, dirty, valid, changeKey, rerun, delay, save]);

  return { saving, failed, save };
}
