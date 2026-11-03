import type { Messages } from '../../i18n/messages';

/** One abstract reel: segment bars on top, a story-ring avatar on the front one, a product pill at the bottom. */
function Reel({ front = false, className = '' }: { front?: boolean; className?: string }) {
  return (
    <div
      className={`flex aspect-[9/16] w-auto shrink-0 flex-col justify-between rounded-[clamp(14px,2.2dvh,20px)] border border-border p-[clamp(8px,1.4dvh,12px)] ${front ? 'h-full bg-card shadow-card' : 'h-[84%] bg-secondary/70'} ${className}`}
    >
      <div className="flex gap-1">
        <span className="h-[3px] flex-1 rounded-full bg-foreground/70" />
        <span className={`h-[3px] flex-1 rounded-full ${front ? 'bg-primary' : 'bg-foreground/20'}`} />
        <span className="h-[3px] flex-1 rounded-full bg-foreground/20" />
      </div>
      {front ? (
        <span className="mx-auto size-[clamp(36px,6dvh,56px)] rounded-full p-[3px] [background:var(--story-ring-gradient)]">
          <span className="block size-full rounded-full border-[3px] border-card bg-secondary" />
        </span>
      ) : null}
      <div className="flex items-center gap-2 rounded-xl bg-foreground/[0.06] p-2">
        <span className={`size-7 shrink-0 rounded-lg ${front ? 'bg-accent' : 'bg-foreground/15'}`} />
        <span className="flex flex-1 flex-col gap-1.5">
          <span className="h-1.5 w-4/5 rounded-full bg-foreground/30" />
          <span className="h-1.5 w-1/2 rounded-full bg-foreground/15" />
        </span>
      </div>
    </div>
  );
}

/**
 * Auth panel illustration, deliberately abstract: three fanned reels (no copy, decorative) and the three outcomes
 * as a quiet line of numbers (real text for assistive tech).
 */
export function BrandShowcase({ a }: { a: Messages['auth'] }) {
  const stats = [
    { value: a.statEngagementVal, label: a.statEngagement },
    { value: a.statAovVal, label: a.statAov },
    { value: a.statZeroCodeVal, label: a.statZeroCode },
  ];
  return (
    <div className="flex w-full max-w-[520px] flex-col items-center gap-[clamp(16px,3.5dvh,32px)]">
      {/* Fan is a picture, not reading order: fixed LTR so it looks the same in both languages. */}
      <div aria-hidden="true" dir="ltr" className="flex h-[clamp(200px,36dvh,380px)] items-center justify-center [@media(max-height:600px)]:hidden">
        <Reel className="-me-[7%] translate-y-[4%] -rotate-[8deg]" />
        <Reel front className="relative z-10" />
        <Reel className="-ms-[7%] translate-y-[4%] rotate-[8deg]" />
      </div>
      <dl className="grid w-full grid-cols-3 gap-4 [@media(max-height:760px)]:hidden">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col-reverse items-center gap-1">
            <dt className="text-small text-muted-foreground">{s.label}</dt>
            <dd className="text-[clamp(1.25rem,3dvh,1.75rem)] leading-tight font-extrabold text-foreground" dir="ltr">
              {s.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
