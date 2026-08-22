import type { LucideIcon } from "lucide-react";

// UI/UX Modernization doc §23 "Empty states" — "Do not simply display
// 'No data found.'" Every empty state gets an icon, a plain-language
// explanation of what's missing and why it matters, and (optionally) the
// one action that fixes it.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center py-10 px-6">
      <div className="w-11 h-11 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] flex items-center justify-center mb-3">
        <Icon size={20} className="text-ink-muted" strokeWidth={1.75} />
      </div>
      <p className="text-[14px] font-semibold text-ink-primary">{title}</p>
      <p className="text-[12.5px] text-ink-muted mt-1 max-w-xs">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
