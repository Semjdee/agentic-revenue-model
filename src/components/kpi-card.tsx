import clsx from "clsx";
import { TrendIndicator } from "@/components/ui/trend-indicator";

// UI/UX Modernization doc §6 "Restructure dashboard hierarchy" — primary
// KPIs (Revenue, Open Pipeline, Sales, ROAS) get stronger visual emphasis
// than secondary activity metrics. `size="primary"` is the only new
// concept vs. the previous version; `trendPct`/`subtitle` are additive
// too, so nothing that already used this component without them breaks.
export function KpiCard({
  label,
  value,
  hint,
  tone,
  size = "secondary",
  trendPct,
  subtitle,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "critical";
  size?: "primary" | "secondary";
  /** vs. the previous equivalent period — see lib/format.ts's percentChange(). */
  trendPct?: number | null;
  /** A second, smaller line under the value — e.g. "12 opportunities." Never a raw usage number per this app's own credit/token privacy rule; fine for business metrics like this. */
  subtitle?: string;
}) {
  const primary = size === "primary";
  return (
    <div className={clsx("card", primary ? "p-5" : "p-4")}>
      <p className="text-[11.5px] font-medium text-ink-muted uppercase tracking-wide">{label}</p>
      <p className={clsx("font-semibold text-ink-primary mt-1 tabular-nums", primary ? "text-[30px]" : "text-[22px]")}>{value}</p>
      <div className="flex items-center gap-2 mt-1">
        {trendPct !== undefined && <TrendIndicator pct={trendPct} />}
        {subtitle && <span className="text-[11.5px] text-ink-muted">{subtitle}</span>}
      </div>
      {hint && (
        <p className={clsx("text-[11.5px] mt-1", tone === "good" ? "text-status-good" : tone === "critical" ? "text-status-critical" : "text-ink-muted")}>
          {hint}
        </p>
      )}
    </div>
  );
}
