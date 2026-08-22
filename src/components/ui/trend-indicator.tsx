import clsx from "clsx";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";

// UI/UX Modernization doc §7 "Add trend indicators" — a reusable
// ↑/↓/— component every KPI can opt into. `pct` is `null` when there's
// no meaningful prior-period value to compare against (see
// lib/format.ts's percentChange()) — the doc's own rule: "Do not show
// meaningless comparison data when insufficient information exists,"
// so this renders nothing at all rather than a fabricated 0%/∞%.
export function TrendIndicator({ pct, className }: { pct: number | null; className?: string }) {
  if (pct === null) return null;
  const flat = Math.abs(pct) < 0.5;
  const up = pct > 0;
  const Icon = flat ? Minus : up ? ArrowUp : ArrowDown;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-0.5 text-[12px] font-medium tabular-nums",
        flat ? "text-ink-muted" : up ? "text-status-good" : "text-status-critical",
        className
      )}
    >
      <Icon size={12} strokeWidth={2.5} />
      {flat ? "No change" : `${Math.abs(pct).toFixed(1)}%`}
    </span>
  );
}
