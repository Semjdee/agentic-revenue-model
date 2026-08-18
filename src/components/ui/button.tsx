import { forwardRef } from "react";
import clsx from "clsx";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export const Button = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={clsx(
          "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap",
          size === "sm" ? "text-[12.5px] px-2.5 py-1.5" : "text-[13.5px] px-3.5 py-2",
          variant === "primary" && "bg-brand-500 text-white hover:bg-brand-600",
          variant === "secondary" && "bg-black/[0.04] text-ink-primary hover:bg-black/[0.08] dark:bg-white/10 dark:hover:bg-white/15",
          variant === "ghost" && "text-ink-secondary hover:bg-black/[0.04] dark:hover:bg-white/10",
          variant === "danger" && "bg-status-critical/10 text-status-critical hover:bg-status-critical/20",
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
