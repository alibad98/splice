'use client';

import { useEffect, useRef, useState } from 'react';
import type { ContentItem } from '@slips/contracts';
import { useSession } from '../../session/SessionProvider';
import { useI18n } from '../../../i18n/provider';
import { loadPreview, type PreparedPreview } from '../../../lib/api/preview';

export const PREVIEW_TIMEOUT_MS = 10_000;
export function useLivePreview(saved: ContentItem | null) {
  const client = useSession()?.client;
  const { locale } = useI18n();
  const iframe = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const current = useRef<PreparedPreview | null>(null);
  const fetching = useRef(false);
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const [src, setSrc] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [skeleton, setSkeleton] = useState(false);
  const [hasView, setHasView] = useState(false);
  const startupTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const post = () => {
    if (!ready.current || !current.current) return;
    iframe.current?.contentWindow?.postMessage({ type: 'slips.preview.update', v: 1, manifest: current.current.manifest, locale: localeRef.current }, window.location.origin);
    setHasView(true);
    if (!fetching.current) { clearTimeout(startupTimer.current); setLoading(false); setSkeleton(false); }
  };
  // Register before assigning src: cached iframe startup cannot beat the listener.
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== iframe.current?.contentWindow || event.data?.type !== 'slips.preview.ready' || event.data?.v !== 1) return;
      ready.current = true; post();
    };
    window.addEventListener('message', receive);
    setSrc('/player-preview/index.html');
    return () => { window.removeEventListener('message', receive); ready.current = false; current.current?.release(); current.current = null; clearTimeout(startupTimer.current); };
  }, []);
  useEffect(() => { post(); }, [locale]);
  useEffect(() => {
    if (!saved || !client) return;
    const controller = new AbortController();
    let active = true;
    fetching.current = true;
    setLoading(true); setError(false); setSkeleton(false);
    const skeletonTimer = setTimeout(() => { if (active) setSkeleton(true); }, 150);
    startupTimer.current = setTimeout(() => { if (active) { controller.abort(); setError(true); setLoading(false); } }, PREVIEW_TIMEOUT_MS);
    void loadPreview(client, saved.id, controller.signal, current.current).then(prepared => {
      if (!active || controller.signal.aborted) { prepared.release(); return; }
      fetching.current = false;
      const previous = current.current;
      current.current = prepared;
      post(); previous?.release();
    }).catch(() => { if (active) { fetching.current = false; setError(true); setLoading(false); clearTimeout(startupTimer.current); } });
    return () => { active = false; controller.abort(); clearTimeout(skeletonTimer); clearTimeout(startupTimer.current); };
  }, [saved, client, attempt]);
  return { iframe, src, loading, skeleton, error, hasView, fail: () => { ready.current = false; setError(true); setLoading(false); }, retry: () => {
    if (!ready.current && iframe.current) iframe.current.src = '/player-preview/index.html';
    setAttempt(n => n + 1);
  } };
}
