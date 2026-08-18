import clsx from "clsx";

export function KpiCard({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "critical" }) {
  return (
    <div className="card p-4">
      <p className="text-[11.5px] font-medium text-ink-muted uppercase tracking-wide">{label}</p>
      <p className="text-[22px] font-semibold text-ink-primary mt-1 tabular-nums">{value}</p>
      {hint && (
        <p className={clsx("text-[11.5px] mt-1", tone === "good" ? "text-status-good" : tone === "critical" ? "text-status-critical" : "text-ink-muted")}>
          {hint}
        </p>
      )}
    </div>
  );
}
