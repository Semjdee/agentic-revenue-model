"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import clsx from "clsx";

interface IndustryTemplate {
  id: string;
  key: string;
  label: string;
  description: string | null;
  tone: string | null;
  qualificationQuestions: string[];
  salesRules: string[];
  restrictedTopics: string[];
  escalationConditions: string[];
  knowledgeBaseSuggestions: string[];
  productCategorySuggestions: string[];
  isActive: boolean;
}

const LIST_FIELDS = [
  "qualificationQuestions",
  "salesRules",
  "restrictedTopics",
  "escalationConditions",
  "knowledgeBaseSuggestions",
  "productCategorySuggestions",
] as const;
const LIST_LABELS: Record<(typeof LIST_FIELDS)[number], string> = {
  qualificationQuestions: "Qualification questions",
  salesRules: "Sales rules",
  restrictedTopics: "Restricted topics",
  escalationConditions: "Escalation conditions",
  knowledgeBaseSuggestions: "Suggested KB doc titles",
  productCategorySuggestions: "Suggested product categories",
};

const EMPTY_FORM = {
  key: "",
  label: "",
  description: "",
  tone: "",
  qualificationQuestions: "",
  salesRules: "",
  restrictedTopics: "",
  escalationConditions: "",
  knowledgeBaseSuggestions: "",
  productCategorySuggestions: "",
};

export default function IndustryTemplatesPage() {
  const [templates, setTemplates] = useState<IndustryTemplate[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await api.get<{ templates: IndustryTemplate[] }>("/api/platform/industry-templates");
    setTemplates(res.templates);
  }
  useEffect(() => {
    load();
  }, []);

  function lines(s: string): string[] {
    return s.split("\n").map((l) => l.trim()).filter(Boolean);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await api.post("/api/platform/industry-templates", {
        key: form.key.trim().toUpperCase().replace(/\s+/g, "_"),
        label: form.label.trim(),
        description: form.description.trim() || undefined,
        tone: form.tone.trim() || undefined,
        qualificationQuestions: lines(form.qualificationQuestions),
        salesRules: lines(form.salesRules),
        restrictedTopics: lines(form.restrictedTopics),
        escalationConditions: lines(form.escalationConditions),
        knowledgeBaseSuggestions: lines(form.knowledgeBaseSuggestions),
        productCategorySuggestions: lines(form.productCategorySuggestions),
      });
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create template");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(t: IndustryTemplate) {
    await api.patch(`/api/platform/industry-templates/${t.id}`, { isActive: !t.isActive });
    load();
  }

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h1 className="text-[18px] font-semibold text-white">Industry Templates</h1>
        <p className="text-[12.5px] text-white/50 mt-0.5">
          Starting points tenants can apply during onboarding — pre-fills the SAME agent/qualification/knowledge-base fields manual setup creates, never a
          parallel agent type. Editable here without a redeploy.
        </p>
      </div>

      <section className="space-y-2">
        {templates.map((t) => (
          <div key={t.id} className="border border-white/10 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[14px] font-semibold text-white">
                  {t.label} <span className="text-white/40 text-[12px] font-normal">({t.key})</span>
                </p>
                {t.description && <p className="text-[12px] text-white/50 mt-0.5">{t.description}</p>}
              </div>
              <button
                onClick={() => toggleActive(t)}
                className={clsx(
                  "text-[11px] px-2.5 py-1 rounded-full font-medium",
                  t.isActive ? "bg-emerald-500/15 text-emerald-300" : "bg-white/10 text-white/50"
                )}
              >
                {t.isActive ? "Active" : "Inactive"}
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
              {LIST_FIELDS.map((f) => (
                <div key={f}>
                  <p className="text-[10px] text-white/40 uppercase tracking-wide">{LIST_LABELS[f]}</p>
                  <ul className="text-[11.5px] text-white/70 mt-1 space-y-0.5">
                    {t[f].length === 0 ? <li className="text-white/30">—</li> : t[f].map((v, i) => <li key={i}>• {v}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ))}
        {templates.length === 0 && <p className="text-[13px] text-white/40">No templates yet — add one below.</p>}
      </section>

      <section>
        <h2 className="text-[14px] font-semibold text-white mb-3">Add a template</h2>
        <form onSubmit={create} className="border border-white/10 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Key (SCREAMING_SNAKE_CASE, e.g. SOLAR)</FieldLabel>
              <TextInput value={form.key} onChange={(v) => setForm({ ...form, key: v })} placeholder="SOLAR" />
            </div>
            <div>
              <FieldLabel>Label</FieldLabel>
              <TextInput value={form.label} onChange={(v) => setForm({ ...form, label: v })} placeholder="Solar & Renewable Energy" />
            </div>
          </div>
          <div>
            <FieldLabel>Description</FieldLabel>
            <TextInput value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
          </div>
          <div>
            <FieldLabel>Tone</FieldLabel>
            <TextInput value={form.tone} onChange={(v) => setForm({ ...form, tone: v })} placeholder="consultative, technical but approachable" />
          </div>
          {LIST_FIELDS.map((f) => (
            <div key={f}>
              <FieldLabel>{LIST_LABELS[f]} (one per line)</FieldLabel>
              <textarea
                value={form[f]}
                onChange={(e) => setForm({ ...form, [f]: e.target.value })}
                rows={3}
                className="w-full rounded-lg border border-white/15 bg-white/[0.03] px-3 py-2 text-[12.5px] text-white placeholder:text-white/30"
              />
            </div>
          ))}
          {error && <p className="text-[12.5px] text-status-critical">{error}</p>}
          <button
            type="submit"
            disabled={creating || !form.key.trim() || !form.label.trim()}
            className="rounded-lg bg-white text-black text-[13px] font-medium px-4 py-2 disabled:opacity-40"
          >
            {creating ? "Creating…" : "Create template"}
          </button>
        </form>
      </section>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-white/50 mb-1">{children}</p>;
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-white/15 bg-white/[0.03] px-3 py-2 text-[13px] text-white placeholder:text-white/30"
    />
  );
}
