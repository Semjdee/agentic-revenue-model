"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import * as Tabs from "@radix-ui/react-tabs";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { TagListEditor } from "@/components/tag-list-editor";
import { TestAgentPanel } from "@/components/test-agent-panel";
import { Badge } from "@/components/ui/badge";
import { Check, Copy } from "lucide-react";

interface Agent {
  id: string;
  name: string;
  role: string | null;
  company: string | null;
  instructions: string | null;
  tone: string | null;
  greeting: string | null;
  qualificationQuestions: string[];
  restrictedTopics: string[];
  escalationConditions: string[];
  salesRules: string[];
  widgetColor: string | null;
  status: string;
  publicAgentId: string;
}

interface Product {
  id: string;
  name: string;
  category: string | null;
  price: string | null;
  currency: string;
  availability: string;
}

const TAB_CLASS =
  "px-3.5 py-2 text-[13px] font-medium text-ink-secondary data-[state=active]:text-brand-600 data-[state=active]:border-b-2 data-[state=active]:border-brand-500 -mb-px";

export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [saved, setSaved] = useState(false);

  async function load() {
    setAgent(await api.get<Agent>(`/api/internal/agents/${params.id}`));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` is stable per render and only needs to re-run when the route param changes
  }, [params.id]);

  async function save(patch: Partial<Agent>) {
    if (!agent) return;
    await api.patch(`/api/internal/agents/${agent.id}`, patch);
    setAgent({ ...agent, ...patch });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  if (!agent) return <div className="px-8 pt-6 text-[13px] text-ink-muted">Loading…</div>;

  return (
    <div className="pb-16">
      <PageHeader
        title={agent.name}
        description="Configure how this AI Sales Agent behaves, what it knows, and where it's embedded."
        actions={
          <div className="flex items-center gap-2">
            {saved && <span className="text-[12px] text-status-good">Saved</span>}
            <Badge tone={agent.status === "ACTIVE" ? "good" : "neutral"}>{agent.status}</Badge>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => save({ status: agent.status === "ACTIVE" ? "PAUSED" : "ACTIVE" })}
            >
              {agent.status === "ACTIVE" ? "Pause agent" : "Activate agent"}
            </Button>
          </div>
        }
      />

      <div className="px-5 md:px-8">
        <Tabs.Root defaultValue="config">
          <Tabs.List className="flex gap-1 border-b border-black/10 dark:border-white/10 mb-5">
            <Tabs.Trigger value="config" className={TAB_CLASS}>Configuration</Tabs.Trigger>
            <Tabs.Trigger value="rules" className={TAB_CLASS}>Qualification & Rules</Tabs.Trigger>
            <Tabs.Trigger value="products" className={TAB_CLASS}>Products</Tabs.Trigger>
            <Tabs.Trigger value="widget" className={TAB_CLASS}>Widget & Embed</Tabs.Trigger>
            <Tabs.Trigger value="test" className={TAB_CLASS}>Test Agent</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="config" className="max-w-xl space-y-4">
            <Field label="Name" value={agent.name} onSave={(v) => save({ name: v })} />
            <Field label="Role" value={agent.role ?? ""} onSave={(v) => save({ role: v })} />
            <Field label="Company" value={agent.company ?? ""} onSave={(v) => save({ company: v })} />
            <div>
              <Label>Tone</Label>
              <Input defaultValue={agent.tone ?? ""} onBlur={(e) => save({ tone: e.target.value })} placeholder="friendly, professional" />
            </div>
            <div>
              <Label>Greeting message (first thing the customer sees)</Label>
              <Textarea rows={2} defaultValue={agent.greeting ?? ""} onBlur={(e) => save({ greeting: e.target.value })} />
            </div>
            <div>
              <Label>Instructions</Label>
              <Textarea
                rows={6}
                defaultValue={agent.instructions ?? ""}
                onBlur={(e) => save({ instructions: e.target.value })}
                placeholder="Describe how this agent should behave, what to prioritize, and how to represent the business."
              />
            </div>
          </Tabs.Content>

          <Tabs.Content value="rules" className="max-w-xl space-y-6">
            <div>
              <Label>Qualification questions (asked in order)</Label>
              <TagListEditor items={agent.qualificationQuestions} onChange={(v) => save({ qualificationQuestions: v })} placeholder="Add a question…" />
            </div>
            <div>
              <Label>Restricted topics</Label>
              <TagListEditor items={agent.restrictedTopics} onChange={(v) => save({ restrictedTopics: v })} placeholder="e.g. medical advice" />
            </div>
            <div>
              <Label>Escalation conditions</Label>
              <TagListEditor items={agent.escalationConditions} onChange={(v) => save({ escalationConditions: v })} placeholder="e.g. customer sounds frustrated" />
            </div>
            <div>
              <Label>Sales rules</Label>
              <TagListEditor items={agent.salesRules} onChange={(v) => save({ salesRules: v })} placeholder="e.g. never discount more than 5% without approval" />
            </div>
            <div className="card p-3 bg-black/[0.02] dark:bg-white/[0.03]">
              <p className="text-[12px] text-ink-secondary">
                The agent will never fabricate prices, stock, discounts, warranties, or delivery times — it only uses what&apos;s in{" "}
                <strong>Products</strong> and the <strong>Knowledge Base</strong>. If it can&apos;t find an answer there, it escalates to a human instead of guessing.
              </p>
            </div>
          </Tabs.Content>

          <Tabs.Content value="products">
            <ProductsTab />
          </Tabs.Content>

          <Tabs.Content value="widget" className="max-w-xl">
            <WidgetTab agent={agent} />
          </Tabs.Content>

          <Tabs.Content value="test" className="max-w-xl">
            {/* Same sandbox used by the onboarding wizard (docs/ONBOARDING_SPEC.md
                addendum §A13 — testing must remain available after onboarding,
                for every agent, always). */}
            <TestAgentPanel agentId={agent.id} />
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </div>
  );
}

function Field({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input defaultValue={value} onBlur={(e) => e.target.value !== value && onSave(e.target.value)} />
    </div>
  );
}

function ProductsTab() {
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState({ name: "", category: "", price: "", description: "" });
  const [loading, setLoading] = useState(true);

  async function load() {
    setProducts(await api.get<Product[]>("/api/internal/products"));
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    await api.post("/api/internal/products", { ...form, currency: "UGX", availability: "IN_STOCK", features: [], sellingPoints: [] });
    setForm({ name: "", category: "", price: "", description: "" });
    load();
  }

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-5">
      <div className="space-y-2">
        {loading && <p className="text-[13px] text-ink-muted">Loading…</p>}
        {products.map((p) => (
          <div key={p.id} className="card p-3 flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-ink-primary">{p.name}</p>
              <p className="text-[12px] text-ink-secondary">{p.category}</p>
            </div>
            <p className="text-[13px] tabular-nums text-ink-primary">{p.price ? `${p.currency} ${Number(p.price).toLocaleString()}` : "No price set"}</p>
          </div>
        ))}
        {!loading && products.length === 0 && <p className="text-[13px] text-ink-muted">No products yet — add your catalogue so the AI can recommend accurately.</p>}
      </div>
      <form onSubmit={create} className="card p-4 space-y-3 h-fit">
        <p className="text-[13px] font-semibold text-ink-primary">Add product</p>
        <Input required placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <Input placeholder="Price (UGX)" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        <Textarea rows={3} placeholder="Description / selling points" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <Button type="submit" className="w-full">Add product</Button>
      </form>
    </div>
  );
}

function WidgetTab({ agent }: { agent: Agent }) {
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const snippet = `<script\n  src="${origin}/widget.js"\n  data-agent="${agent.publicAgentId}"\n  async>\n</script>`;

  function copy() {
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-4">
      <div>
        <Label>Installation snippet</Label>
        <div className="relative">
          <pre className="bg-black text-white text-[12px] rounded-lg p-4 overflow-x-auto">{snippet}</pre>
          <button onClick={copy} className="absolute top-2 right-2 p-1.5 rounded-md bg-white/10 text-white hover:bg-white/20">
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
        <p className="text-[12px] text-ink-secondary mt-2">
          Paste this before the closing <code>&lt;/body&gt;</code> tag on any page. It loads independently of this back-office app.
        </p>
      </div>
      <div>
        <Label>Try it now</Label>
        <a
          href={`/demo?agent=${agent.publicAgentId}`}
          target="_blank"
          className="text-[13px] text-brand-600 font-medium hover:underline"
        >
          Open a live demo page with this widget installed →
        </a>
      </div>
    </div>
  );
}
