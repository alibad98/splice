// Analytics batcher (cap 5 KB gzip). Placeholder until Epic 7; framework-free.
export interface AnalyticsEvent {
  name: string;
  at: number;
}

export function createBatcher(send: (batch: AnalyticsEvent[]) => void, max = 20) {
  let queue: AnalyticsEvent[] = [];
  const flush = () => {
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    send(batch);
  };
  return {
    track(name: string) {
      queue.push({ name, at: Date.now() });
      if (queue.length >= max) flush();
    },
    flush,
  };
}
