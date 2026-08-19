"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Check } from "lucide-react";
import clsx from "clsx";
import { TestAgentPanel } from "@/components/test-agent-panel";

// Keep this list's order in sync with schema.ONBOARDING_STEPS — duplicated
// here (rather than importing the Drizzle schema into a client component)
// because this is purely a display/order concern, not a query.
const STEP_ORDER = [
  "ACCOUNT",
  "BUSINESS_PROFILE",
  "KNOWLEDGE_IMPORT",
  "AGENT_SETUP",
  "AGENT_TEST",
  "CHANNEL_CONNECT",
  "HEALTH_CHECK",
  "GO_LIVE",
] as const;
type Step = (typeof STEP_ORDER)[number];

const STEP_LABELS: Record<Step, string> = {
  ACCOUNT: "Create account",
  BUSINESS_PROFILE: "Business profile",
  KNOWLEDGE_IMPORT: "Products & knowledge",
  AGENT_SETUP: "Meet your AI Sales Agent",
  AGENT_TEST: "Test your agent",
  CHANNEL_CONNECT: "Connect a channel",
  HEALTH_CHECK: "Health check",
  GO_LIVE: "Go live",
};

// Which steps have real, built UI vs. are still on the roadmap
// (docs/ONBOARDING_TASKS.md Milestones 4-9). Kept as an explicit map
// rather than inferring from currentStep so it's obvious at a glance what
// still needs building — and so the UI never pretends an unbuilt step is
// "done" (spec section 35).
const STEP_IS_BUILT: Record<Step, boolean> = {
  ACCOUNT: true,
  BUSINESS_PROFILE: true,
  KNOWLEDGE_IMPORT: true,
  AGENT_SETUP: true,
  AGENT_TEST: true,
  CHANNEL_CONNECT: true,
  HEALTH_CHECK: true,
  GO_LIVE: true,
};

interface Progress {
  currentStep: Step;
  completedSteps: string[];
  agentId: string | null;
}

interface Tenant {
  name: string;
  industry: string | null;
  country: string | null;
  currency: string | null;
  timezone: string | null;
  websiteUrl: string | null;
  description: string | null;
  primaryObjective: string | null;
  primaryChannel: string | null;
}

export function OnboardingWizard({ session }: { session: { tenantId: string; name: string; role: string } }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    const [p, t] = await Promise.all([
      api.get<Progress>("/api/internal/onboarding/progress"),
      api.get<Tenant>("/api/internal/onboarding/business-profile"),
    ]);
    setProgress(p);
    setTenant(t);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load() is stable; only want this on mount
  }, []);

  if (loading || !progress || !tenant) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-plane">
        <p className="text-[13px] text-ink-muted">Loading…</p>
      </div>
    );
  }

  const currentIndex = STEP_ORDER.indexOf(progress.currentStep);

  return (
    <div className="min-h-screen bg-plane">
      <header className="border-b border-black/10 dark:border-white/10 px-5 py-3 flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-brand-500 flex items-center justify-center text-white text-[13px] font-bold">RA</div>
        <span className="font-semibold text-ink-primary text-[14px]">Revenue Agent — Setup</span>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-8">
        <aside>
          <p className="text-[12px] font-medium text-ink-secondary mb-3">
            You&apos;re {STEP_ORDER.length - currentIndex} step{STEP_ORDER.length - currentIndex === 1 ? "" : "s"} away from going live.
          </p>
          <ol className="space-y-1">
            {STEP_ORDER.map((step, i) => {
              const done = progress.completedSteps.includes(step);
              const active = step === progress.currentStep;
              return (
                <li
                  key={step}
                  className={clsx(
                    "flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px]",
                    active && "bg-brand-50 dark:bg-brand-900/30 text-ink-primary font-medium",
                    !active && done && "text-ink-secondary",
                    !active && !done && "text-ink-muted"
                  )}
                >
                  <span
                    className={clsx(
                      "w-4 h-4 rounded-full flex items-center justify-center shrink-0 text-[9px]",
                      done ? "bg-brand-500 text-white" : active ? "border-2 border-brand-500" : "border border-black/15 dark:border-white/20"
                    )}
                  >
                    {done && <Check size={10} />}
                  </span>
                  {STEP_LABELS[step]}
                  {i === currentIndex && !STEP_IS_BUILT[step] && <span className="text-[10px] text-ink-muted ml-auto">soon</span>}
                </li>
              );
            })}
          </ol>
        </aside>

        <main className="card p-6">
          {progress.currentStep === "BUSINESS_PROFILE" && (
            <BusinessProfileStep session={session} tenant={tenant} onDone={load} />
          )}
          {progress.currentStep === "KNOWLEDGE_IMPORT" && <KnowledgeImportStep onDone={load} />}
          {progress.currentStep === "AGENT_SETUP" && <AgentSetupStep onDone={load} />}
          {progress.currentStep === "AGENT_TEST" && progress.agentId && (
            <AgentTestStep agentId={progress.agentId} onDone={load} />
          )}
          {progress.currentStep === "CHANNEL_CONNECT" && progress.agentId && (
            <ChannelConnectStep agentId={progress.agentId} tenant={tenant} onDone={load} />
          )}
          {progress.currentStep === "HEALTH_CHECK" && <HealthCheckStep onDone={load} />}
          {progress.currentStep === "GO_LIVE" && progress.agentId && <GoLiveStep agentId={progress.agentId} />}
          {!STEP_IS_BUILT[progress.currentStep] && (
            <UnbuiltStepFallback stepLabel={STEP_LABELS[progress.currentStep]} />
          )}
        </main>
      </div>
    </div>
  );
}

function BusinessProfileStep({ tenant, onDone }: { session: { tenantId: string; name: string; role: string }; tenant: Tenant; onDone: () => void }) {
  const [form, setForm] = useState({
    businessName: tenant.name ?? "",
    industry: tenant.industry ?? "",
    country: tenant.country ?? "",
    currency: tenant.currency ?? "",
    timezone: tenant.timezone ?? "",
    websiteUrl: tenant.websiteUrl ?? "",
    description: tenant.description ?? "",
    primaryObjective: tenant.primaryObjective ?? "",
    primaryChannel: tenant.primaryChannel ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.patch("/api/internal/onboarding/business-profile", form);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your business profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h1 className="text-[16px] font-semibold text-ink-primary">Tell us about your business</h1>
        <p className="text-[12.5px] text-ink-secondary mt-0.5">Just the essentials — you can refine everything later.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Business name</Label>
          <Input required value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
        </div>
        <div>
          <Label>Industry</Label>
          <Input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} placeholder="Solar energy" />
        </div>
        <div>
          <Label>Country</Label>
          <Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="Uganda" />
        </div>
        <div>
          <Label>Currency</Label>
          <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} placeholder="UGX" />
        </div>
        <div>
          <Label>Timezone</Label>
          <Input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} placeholder="Africa/Kampala" />
        </div>
        <div>
          <Label>Website (optional)</Label>
          <Input type="url" value={form.websiteUrl} onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })} placeholder="https://…" />
        </div>
      </div>
      <div>
        <Label>What does your business do?</Label>
        <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Primary sales objective</Label>
          <Input value={form.primaryObjective} onChange={(e) => setForm({ ...form, primaryObjective: e.target.value })} placeholder="Generate qualified leads" />
        </div>
        <div>
          <Label>Primary customer channel</Label>
          <Input value={form.primaryChannel} onChange={(e) => setForm({ ...form, primaryChannel: e.target.value })} placeholder="WhatsApp" />
        </div>
      </div>
      {error && <p className="text-[12.5px] text-status-critical">{error}</p>}
      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Continue"}
      </Button>
    </form>
  );
}

interface DraftProduct {
  name: string;
  description: string;
  price: string;
  currency: string;
}

const EMPTY_PRODUCT: DraftProduct = { name: "", description: "", price: "", currency: "" };

function KnowledgeImportStep({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"choose" | "manual">("choose");
  const [products, setProducts] = useState<DraftProduct[]>([{ ...EMPTY_PRODUCT }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function skip() {
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/internal/onboarding/knowledge-import", { action: "skip" });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not continue");
    } finally {
      setSaving(false);
    }
  }

  async function submitProducts(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = products.filter((p) => p.name.trim());
    if (!cleaned.length) {
      setError("Add at least one product, or skip for now.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/internal/onboarding/knowledge-import", {
        action: "add_products",
        products: cleaned.map((p) => ({ ...p, currency: p.currency || "UGX" })),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your products");
    } finally {
      setSaving(false);
    }
  }

  if (mode === "choose") {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-[16px] font-semibold text-ink-primary">What should your AI Sales Agent know?</h1>
          <p className="text-[12.5px] text-ink-secondary mt-0.5">
            Give it your products and pricing — you can add more (FAQs, policies, documents) anytime from Knowledge
            Base.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <ComingSoonOption label="Scan My Website" />
          <ComingSoonOption label="Upload Product Catalogue" />
          <ComingSoonOption label="Upload Price List" />
          <ComingSoonOption label="Upload Business Documents" />
          <button
            type="button"
            onClick={() => setMode("manual")}
            className="text-left rounded-lg border border-black/10 dark:border-white/15 p-3 hover:border-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition-colors"
          >
            <p className="text-[13px] font-medium text-ink-primary">Add Products Manually</p>
            <p className="text-[11.5px] text-ink-muted mt-0.5">Type in a few products now</p>
          </button>
          <button
            type="button"
            onClick={skip}
            disabled={saving}
            className="text-left rounded-lg border border-black/10 dark:border-white/15 p-3 hover:border-black/20 dark:hover:border-white/30 transition-colors disabled:opacity-50"
          >
            <p className="text-[13px] font-medium text-ink-primary">Skip for Now</p>
            <p className="text-[11.5px] text-ink-muted mt-0.5">Add products later from Knowledge Base</p>
          </button>
        </div>
        {error && <p className="text-[12.5px] text-status-critical">{error}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={submitProducts} className="space-y-4">
      <div>
        <h1 className="text-[16px] font-semibold text-ink-primary">Add your products</h1>
        <p className="text-[12.5px] text-ink-secondary mt-0.5">Name and price are enough to start — add detail later.</p>
      </div>
      <div className="space-y-3">
        {products.map((p, i) => (
          <div key={i} className="grid grid-cols-[2fr_1fr_1fr] gap-2">
            <Input
              placeholder="Product name"
              value={p.name}
              onChange={(e) => setProducts(products.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            />
            <Input
              placeholder="Price"
              value={p.price}
              onChange={(e) => setProducts(products.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
            />
            <Input
              placeholder="Currency"
              value={p.currency}
              onChange={(e) => setProducts(products.map((x, j) => (j === i ? { ...x, currency: e.target.value } : x)))}
            />
          </div>
        ))}
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={() => setProducts([...products, { ...EMPTY_PRODUCT }])}>
        + Add another product
      </Button>
      {error && <p className="text-[12.5px] text-status-critical">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Continue"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setMode("choose")}>
          Back
        </Button>
      </div>
    </form>
  );
}

function ComingSoonOption({ label }: { label: string }) {
  return (
    <div className="text-left rounded-lg border border-dashed border-black/10 dark:border-white/15 p-3 opacity-60">
      <p className="text-[13px] font-medium text-ink-primary">{label}</p>
      <p className="text-[11.5px] text-ink-muted mt-0.5">Coming soon</p>
    </div>
  );
}

interface ExistingAgent {
  id: string;
  name: string;
  role: string | null;
  status: string;
}

interface GuidedAnswers {
  whatDoYouSell: string;
  typicalCustomers: string;
  whatToCollectFromLead: string;
  whatMakesLeadQualified: string;
  whenToHandOff: string;
  neverPromise: string;
  negotiatePrices: boolean;
  offerDelivery: boolean;
  tone: string;
}

const EMPTY_ANSWERS: GuidedAnswers = {
  whatDoYouSell: "",
  typicalCustomers: "",
  whatToCollectFromLead: "",
  whatMakesLeadQualified: "",
  whenToHandOff: "",
  neverPromise: "",
  negotiatePrices: false,
  offerDelivery: true,
  tone: "friendly, professional",
};

interface GuidedConfig {
  name: string;
  role: string;
  company?: string;
  instructions: string;
  tone: string;
  languageRules: string[];
  qualificationQuestions: string[];
  salesRules: string[];
  restrictedTopics: string[];
  escalationConditions: string[];
}

function AgentSetupStep({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"loading" | "choose" | "questions" | "review" | "pick-existing">("loading");
  const [existingAgents, setExistingAgents] = useState<ExistingAgent[]>([]);
  const [answers, setAnswers] = useState<GuidedAnswers>({ ...EMPTY_ANSWERS });
  const [config, setConfig] = useState<GuidedConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<ExistingAgent[]>("/api/internal/agents").then((agents) => {
      setExistingAgents(agents);
      // addendum §A9/§A10: skip the "you already have agents" choice
      // screen straight to guided questions for a brand-new tenant; only
      // show the choice when there's something to choose between.
      setMode(agents.length ? "choose" : "questions");
    });
  }, []);

  async function selectExistingAgent(agentId: string) {
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/internal/onboarding/use-existing-agent", { agentId });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not continue");
    } finally {
      setSaving(false);
    }
  }

  async function preview(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const cfg = await api.put<GuidedConfig>("/api/internal/agents/guided", answers);
      setConfig(cfg);
      setMode("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate your agent");
    } finally {
      setSaving(false);
    }
  }

  async function createAgent() {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/internal/agents/guided", config);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create your agent");
    } finally {
      setSaving(false);
    }
  }

  if (mode === "loading") return <p className="text-[13px] text-ink-muted">Loading…</p>;

  if (mode === "choose") {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-[16px] font-semibold text-ink-primary">You already have AI Agents</h1>
          <p className="text-[12.5px] text-ink-secondary mt-0.5">Use one of them for this setup, or create a new one.</p>
        </div>
        <div className="space-y-2">
          {existingAgents.map((a) => (
            <button
              key={a.id}
              onClick={() => selectExistingAgent(a.id)}
              disabled={saving}
              className="w-full text-left rounded-lg border border-black/10 dark:border-white/15 p-3 hover:border-brand-500 transition-colors disabled:opacity-50"
            >
              <p className="text-[13px] font-medium text-ink-primary">{a.name}</p>
              <p className="text-[11.5px] text-ink-muted">{a.role || "Agent"} · {a.status}</p>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setMode("questions")}>
            Create New with Guided Setup
          </Button>
          <Button variant="ghost" onClick={() => router.push("/agents")}>
            Create New Manually
          </Button>
        </div>
        {error && <p className="text-[12.5px] text-status-critical">{error}</p>}
      </div>
    );
  }

  if (mode === "review" && config) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-[16px] font-semibold text-ink-primary">Meet your AI Sales Agent</h1>
          <p className="text-[12.5px] text-ink-secondary mt-0.5">Review what we set up — you can edit anything later.</p>
        </div>
        <dl className="space-y-2 text-[12.5px]">
          <Row label="Name" value={config.name} />
          <Row label="Role" value={config.role} />
          <Row label="Tone" value={config.tone} />
          <Row label="Languages" value={config.languageRules.join(", ")} />
          <Row label="Qualification" value={config.qualificationQuestions.join(" · ")} />
          <Row label="Human Handoff" value={config.escalationConditions.join(" · ") || "—"} />
        </dl>
        {error && <p className="text-[12.5px] text-status-critical">{error}</p>}
        <div className="flex gap-2">
          <Button onClick={createAgent} disabled={saving}>
            {saving ? "Creating…" : "Create Agent"}
          </Button>
          <Button variant="ghost" onClick={() => setMode("questions")}>
            Edit
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={preview} className="space-y-4">
      <div>
        <h1 className="text-[16px] font-semibold text-ink-primary">Meet your AI Sales Agent</h1>
        <p className="text-[12.5px] text-ink-secondary mt-0.5">Answer a few questions about your business — no prompts to write.</p>
      </div>
      <div>
        <Label>What does your business sell?</Label>
        <Textarea required rows={2} value={answers.whatDoYouSell} onChange={(e) => setAnswers({ ...answers, whatDoYouSell: e.target.value })} />
      </div>
      <div>
        <Label>Who are your typical customers?</Label>
        <Input value={answers.typicalCustomers} onChange={(e) => setAnswers({ ...answers, typicalCustomers: e.target.value })} />
      </div>
      <div>
        <Label>What information should the AI collect from a potential customer?</Label>
        <Input required value={answers.whatToCollectFromLead} onChange={(e) => setAnswers({ ...answers, whatToCollectFromLead: e.target.value })} placeholder="e.g. what product they need and their timeframe" />
      </div>
      <div>
        <Label>What makes a lead qualified?</Label>
        <Input value={answers.whatMakesLeadQualified} onChange={(e) => setAnswers({ ...answers, whatMakesLeadQualified: e.target.value })} />
      </div>
      <div>
        <Label>When should the AI hand over to a human?</Label>
        <Input value={answers.whenToHandOff} onChange={(e) => setAnswers({ ...answers, whenToHandOff: e.target.value })} placeholder="e.g. pricing exceptions, complaints" />
      </div>
      <div>
        <Label>Is there anything the AI must never promise?</Label>
        <Input value={answers.neverPromise} onChange={(e) => setAnswers({ ...answers, neverPromise: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
          <input type="checkbox" checked={answers.negotiatePrices} onChange={(e) => setAnswers({ ...answers, negotiatePrices: e.target.checked })} />
          We negotiate prices
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
          <input type="checkbox" checked={answers.offerDelivery} onChange={(e) => setAnswers({ ...answers, offerDelivery: e.target.checked })} />
          We offer delivery
        </label>
      </div>
      <div>
        <Label>Tone</Label>
        <Input value={answers.tone} onChange={(e) => setAnswers({ ...answers, tone: e.target.value })} />
      </div>
      {error && <p className="text-[12.5px] text-status-critical">{error}</p>}
      <Button type="submit" disabled={saving}>
        {saving ? "Generating…" : "Continue"}
      </Button>
    </form>
  );
}

function AgentTestStep({ agentId, onDone }: { agentId: string; onDone: () => void }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function continueToChannel() {
    setSaving(true);
    try {
      await api.post("/api/internal/onboarding/agent-test-complete", {});
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[16px] font-semibold text-ink-primary">Test your agent</h1>
        <p className="text-[12.5px] text-ink-secondary mt-0.5">
          Pretend you&apos;re a customer — nothing here touches real contacts or leads.
        </p>
      </div>
      <TestAgentPanel agentId={agentId} />
      <div className="flex gap-2">
        <Button onClick={continueToChannel} disabled={saving}>
          {saving ? "Continuing…" : "Looks good — continue"}
        </Button>
        <Button variant="ghost" onClick={() => router.push(`/agents/${agentId}`)}>
          Edit agent instead
        </Button>
      </div>
    </div>
  );
}

function ChannelConnectStep({ agentId, tenant, onDone }: { agentId: string; tenant: Tenant; onDone: () => void }) {
  const [publicAgentId, setPublicAgentId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ verified: boolean; reason?: string } | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [connectingWhatsApp, setConnectingWhatsApp] = useState(false);

  useEffect(() => {
    api.get<{ publicAgentId: string }>(`/api/internal/agents/${agentId}`).then((a) => setPublicAgentId(a.publicAgentId));
  }, [agentId]);

  async function connectWhatsApp() {
    setConnectingWhatsApp(true);
    try {
      const { authorizationUrl } = await api.post<{ authorizationUrl: string }>("/api/internal/integrations/whatsapp/connect");
      window.location.href = authorizationUrl;
    } catch {
      setConnectingWhatsApp(false);
    }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const snippet = publicAgentId ? `<script\n  src="${origin}/widget.js"\n  data-agent="${publicAgentId}"\n  async>\n</script>` : "";

  function copy() {
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function verify() {
    setChecking(true);
    setResult(null);
    try {
      const r = await api.get<{ verified: boolean; reason?: string; progress?: unknown }>("/api/internal/onboarding/verify-widget");
      setResult(r);
      if (r.verified) onDone();
    } finally {
      setChecking(false);
    }
  }

  async function skip() {
    setSkipping(true);
    try {
      await api.post("/api/internal/onboarding/channel-connect/skip");
      onDone();
    } finally {
      setSkipping(false);
    }
  }

  const REASON_MESSAGES: Record<string, string> = {
    NO_WEBSITE_URL: "You didn't add a website URL in your business profile, so we can't check automatically.",
    SITE_UNREACHABLE: "We couldn't reach your website just now — check the URL and try again.",
    SNIPPET_NOT_FOUND: "We couldn't find the widget on your site yet. Make sure you pasted the snippet and the page is live.",
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[16px] font-semibold text-ink-primary">Where do customers contact you?</h1>
        <p className="text-[12.5px] text-ink-secondary mt-0.5">Connect just one to get started — add more anytime from Integrations.</p>
      </div>

      <div className="rounded-lg border border-black/10 dark:border-white/15 p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#25D366] flex items-center justify-center text-white text-[12px] font-bold">W</div>
          <div>
            <p className="text-[13px] font-medium text-ink-primary">WhatsApp</p>
            <p className="text-[11px] text-ink-muted">Official WhatsApp Business signup</p>
          </div>
        </div>
        <Button size="sm" onClick={connectWhatsApp} disabled={connectingWhatsApp}>
          {connectingWhatsApp ? "Redirecting…" : "Connect"}
        </Button>
      </div>

      <p className="text-[11px] text-ink-muted text-center">— or —</p>

      <div>
        <p className="text-[13px] font-medium text-ink-primary mb-1.5">Website widget</p>
      </div>
      <div className="relative">
        <pre className="bg-black text-white text-[12px] rounded-lg p-4 overflow-x-auto">{snippet || "Loading…"}</pre>
        <button onClick={copy} disabled={!snippet} className="absolute top-2 right-2 p-1.5 rounded-md bg-white/10 text-white hover:bg-white/20">
          {copied ? <Check size={13} /> : "Copy"}
        </button>
      </div>
      <p className="text-[11.5px] text-ink-muted">
        Paste this before <code>&lt;/body&gt;</code> on your site{tenant.websiteUrl ? ` (${tenant.websiteUrl})` : ""}, then verify below.
      </p>
      <div className="flex gap-2">
        <Button onClick={verify} disabled={checking || !publicAgentId}>
          {checking ? "Checking…" : "Verify Installation"}
        </Button>
        <Button variant="ghost" onClick={skip} disabled={skipping}>
          {skipping ? "…" : "Skip for now"}
        </Button>
      </div>
      {result && !result.verified && (
        <p className="text-[12.5px] text-status-critical">
          {REASON_MESSAGES[result.reason ?? ""] ?? "We couldn't verify the connection."}
        </p>
      )}
    </div>
  );
}

interface HealthCategory {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

function HealthCheckStep({ onDone }: { onDone: () => void }) {
  const [result, setResult] = useState<{ ready: boolean; categories: HealthCategory[] } | null>(null);
  const [checking, setChecking] = useState(true);

  async function run() {
    setChecking(true);
    const r = await api.get<{ ready: boolean; categories: HealthCategory[] }>("/api/internal/onboarding/health-check");
    setResult(r);
    setChecking(false);
    if (r.ready) onDone();
  }

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run on mount only
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[16px] font-semibold text-ink-primary">Health check</h1>
        <p className="text-[12.5px] text-ink-secondary mt-0.5">Making sure everything&apos;s really ready before you go live.</p>
      </div>
      {checking && !result && <p className="text-[13px] text-ink-muted">Checking…</p>}
      {result && (
        <div className="space-y-2">
          {result.categories.map((c) => (
            <div key={c.key} className="flex items-start gap-2 rounded-lg border border-black/10 dark:border-white/15 p-2.5">
              <span
                className={clsx(
                  "w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[9px]",
                  c.ok ? "bg-status-positive text-white" : "bg-status-critical/15 text-status-critical"
                )}
              >
                {c.ok ? <Check size={10} /> : "!"}
              </span>
              <div>
                <p className="text-[13px] font-medium text-ink-primary">{c.label}</p>
                <p className="text-[11.5px] text-ink-muted">{c.detail}</p>
              </div>
            </div>
          ))}
          {!result.ready && (
            <Button onClick={run} disabled={checking} className="mt-1">
              {checking ? "Checking…" : "Check again"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function GoLiveStep({ agentId }: { agentId: string }) {
  const router = useRouter();
  const [going, setGoing] = useState(false);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function goLive() {
    setGoing(true);
    setError(null);
    try {
      await api.post("/api/internal/onboarding/go-live");
      setLive(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not go live");
    } finally {
      setGoing(false);
    }
  }

  if (live) {
    return (
      <div className="space-y-4 text-center py-6">
        <h1 className="text-[18px] font-semibold text-ink-primary">Your AI Sales Agent is live 🎉</h1>
        <p className="text-[13px] text-ink-secondary">It&apos;s now responding to real customers on your connected channel.</p>
        <Button onClick={() => router.push("/dashboard")}>Go to your dashboard</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[16px] font-semibold text-ink-primary">Ready to go live</h1>
        <p className="text-[12.5px] text-ink-secondary mt-0.5">
          This turns on real production processing — your agent starts replying to real customers.
        </p>
      </div>
      {error && <p className="text-[12.5px] text-status-critical">{error}</p>}
      <Button onClick={goLive} disabled={going}>
        {going ? "Going live…" : "Go Live"}
      </Button>
      <Button variant="ghost" onClick={() => router.push(`/agents/${agentId}`)}>
        Review agent first
      </Button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-ink-muted">{label}</dt>
      <dd className="text-ink-primary">{value || "—"}</dd>
    </div>
  );
}

function UnbuiltStepFallback({ stepLabel }: { stepLabel: string }) {
  const router = useRouter();
  return (
    <div className="space-y-3">
      <h1 className="text-[16px] font-semibold text-ink-primary">{stepLabel}</h1>
      <p className="text-[12.5px] text-ink-secondary">
        The guided setup for this step is still being built (see{" "}
        <code className="text-[11.5px]">docs/ONBOARDING_TASKS.md</code>). It isn&apos;t ready yet, so rather than
        block you, you can jump straight into the full application and configure things manually — every guided step
        here maps to something you can already do by hand today.
      </p>
      <Button variant="secondary" onClick={() => router.push("/dashboard")}>
        Go to the full app
      </Button>
    </div>
  );
}
