import clsx from "clsx";

type Tone = "neutral" | "good" | "warning" | "serious" | "critical" | "brand";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-black/[0.05] text-ink-secondary dark:bg-white/10",
  good: "bg-status-good/10 text-status-good",
  warning: "bg-status-warning/15 text-[#8a5a00]",
  serious: "bg-status-serious/15 text-[#9a4a2b]",
  critical: "bg-status-critical/10 text-status-critical",
  brand: "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200",
};

export function Badge({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", TONE_CLASSES[tone], className)}>
      {children}
    </span>
  );
}

export function stageTone(stage: string): Tone {
  if (stage === "WON") return "good";
  if (stage === "LOST") return "critical";
  if (stage === "QUOTATION" || stage === "OPPORTUNITY") return "warning";
  if (stage === "QUALIFIED") return "brand";
  return "neutral";
}
