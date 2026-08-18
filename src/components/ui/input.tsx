import { forwardRef } from "react";
import clsx from "clsx";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={clsx(
      "w-full rounded-lg border border-black/10 dark:border-white/15 bg-surface px-3 py-2 text-[13.5px] text-ink-primary placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500",
      className
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={clsx(
      "w-full rounded-lg border border-black/10 dark:border-white/15 bg-surface px-3 py-2 text-[13.5px] text-ink-primary placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <label className={clsx("block text-[12.5px] font-medium text-ink-secondary mb-1", className)}>{children}</label>;
}
