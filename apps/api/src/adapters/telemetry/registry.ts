// Minimal in-process metric registry rendering the Prometheus text exposition format.
// Vendor-neutral: any scraper (or a later OpenTelemetry bridge) can consume it.
import type { Labels } from '../../ports/telemetry.js';

type Kind = 'counter' | 'gauge' | 'histogram';

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface Series {
  labels: Labels;
  value: number;
  /** Histogram only. */
  buckets?: number[];
  sum?: number;
  count?: number;
}

function labelKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join('\u0000');
}

function escapeValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function renderLabels(labels: Labels, extra?: Record<string, string>): string {
  const all = { ...labels, ...extra };
  const keys = Object.keys(all).sort();
  if (keys.length === 0) return '';
  return `{${keys.map((k) => `${k}="${escapeValue(String(all[k]))}"`).join(',')}}`;
}

export class MetricRegistry {
  private readonly metrics = new Map<string, { kind: Kind; series: Map<string, Series> }>();

  /** Make a metric appear in the output even before it has samples. */
  declare(name: string, kind: Kind, seedLabels: Labels[] = []): void {
    const m = this.metric(name, kind);
    if (kind === 'counter') for (const labels of seedLabels) this.series(m, labels);
  }

  counter(name: string, labels: Labels = {}, value = 1): void {
    if (!(value >= 0)) return;
    this.series(this.metric(name, 'counter'), labels).value += value;
  }

  gauge(name: string, value: number, labels: Labels = {}): void {
    this.series(this.metric(name, 'gauge'), labels).value = value;
  }

  observe(name: string, value: number, labels: Labels = {}): void {
    const s = this.series(this.metric(name, 'histogram'), labels);
    s.buckets ??= BUCKETS.map(() => 0);
    BUCKETS.forEach((le, i) => {
      if (value <= le) s.buckets![i]! += 1;
    });
    s.sum = (s.sum ?? 0) + value;
    s.count = (s.count ?? 0) + 1;
  }

  /** Current value of a counter or gauge series (0 if unseen). For tests and internal checks. */
  value(name: string, labels: Labels = {}): number {
    return this.metrics.get(name)?.series.get(labelKey(labels))?.value ?? 0;
  }

  render(): string {
    const lines: string[] = [];
    for (const [name, m] of [...this.metrics].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`# TYPE ${name} ${m.kind}`);
      for (const s of m.series.values()) {
        if (m.kind === 'histogram') {
          BUCKETS.forEach((le, i) => lines.push(`${name}_bucket${renderLabels(s.labels, { le: String(le) })} ${s.buckets?.[i] ?? 0}`));
          lines.push(`${name}_bucket${renderLabels(s.labels, { le: '+Inf' })} ${s.count ?? 0}`);
          lines.push(`${name}_sum${renderLabels(s.labels)} ${s.sum ?? 0}`);
          lines.push(`${name}_count${renderLabels(s.labels)} ${s.count ?? 0}`);
        } else {
          lines.push(`${name}${renderLabels(s.labels)} ${s.value}`);
        }
      }
    }
    return `${lines.join('\n')}\n`;
  }

  private metric(name: string, kind: Kind) {
    let m = this.metrics.get(name);
    if (!m) {
      m = { kind, series: new Map() };
      this.metrics.set(name, m);
    }
    if (m.kind !== kind) throw new Error(`metric ${name} is a ${m.kind}, not a ${kind}`);
    return m;
  }

  private series(m: { series: Map<string, Series> }, labels: Labels): Series {
    const key = labelKey(labels);
    let s = m.series.get(key);
    if (!s) {
      s = { labels: { ...labels }, value: 0 };
      m.series.set(key, s);
    }
    return s;
  }
}
