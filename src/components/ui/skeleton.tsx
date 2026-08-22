import clsx from "clsx";

// UI/UX Modernization doc §24 "Loading states" — skeleton placeholders
// instead of full-page spinners, so the app feels responsive while data
// loads. `Skeleton` is the primitive; the *Skeleton variants below are
// the shapes this pass actually needed (a KPI card and a generic block) —
// add more as other pages adopt this pattern.
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={clsx("animate-pulse rounded-md bg-black/[0.06] dark:bg-white/[0.08]", className)} style={style} />;
}

export function KpiCardSkeleton({ primary }: { primary?: boolean }) {
  return (
    <div className="card p-4 space-y-2">
      <Skeleton className="h-3 w-20" />
      <Skeleton className={primary ? "h-8 w-32" : "h-6 w-16"} />
      <Skeleton className="h-3 w-24" />
    </div>
  );
}

export function CardSkeleton({ height = 220 }: { height?: number }) {
  return (
    <div className="card p-4 space-y-3">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="w-full rounded-lg" style={{ height }} />
    </div>
  );
}
