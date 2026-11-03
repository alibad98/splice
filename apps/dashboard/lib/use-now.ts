'use client';

import { useEffect, useState } from 'react';

/** The current time, re-read once a minute so "Last synced 5 minutes ago" stays true. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
