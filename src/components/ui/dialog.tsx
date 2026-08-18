"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import clsx from "clsx";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  widthClassName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  widthClassName?: string;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <RadixDialog.Content
          className={clsx(
            "fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-h-[88vh] overflow-y-auto rounded-xl bg-surface border border-black/10 dark:border-white/10 shadow-xl p-5",
            widthClassName ?? "max-w-lg"
          )}
        >
          <div className="flex items-start justify-between mb-3">
            <div>
              <RadixDialog.Title className="text-[15px] font-semibold text-ink-primary">{title}</RadixDialog.Title>
              {description && <RadixDialog.Description className="text-[12.5px] text-ink-secondary mt-0.5">{description}</RadixDialog.Description>}
            </div>
            <RadixDialog.Close className="p-1 text-ink-muted hover:text-ink-primary rounded-md">
              <X size={16} />
            </RadixDialog.Close>
          </div>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
