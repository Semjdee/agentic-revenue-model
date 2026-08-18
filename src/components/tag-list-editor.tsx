"use client";

import { useState } from "react";
import { X, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";

export function TagListEditor({ items, onChange, placeholder }: { items: string[]; onChange: (items: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");

  function add() {
    if (draft.trim()) {
      onChange([...items, draft.trim()]);
      setDraft("");
    }
  }

  return (
    <div>
      <div className="space-y-1.5 mb-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between gap-2 bg-black/[0.03] dark:bg-white/[0.05] rounded-lg px-3 py-1.5">
            <span className="text-[12.5px] text-ink-primary">
              <span className="text-ink-muted mr-1.5">{i + 1}.</span>
              {item}
            </span>
            <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="text-ink-muted hover:text-status-critical">
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" onClick={add} className="shrink-0 px-2.5 rounded-lg bg-black/[0.05] dark:bg-white/10 text-ink-secondary hover:bg-black/[0.1]">
          <Plus size={15} />
        </button>
      </div>
    </div>
  );
}
