"use client";

import { useEffect, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { PlayCircle, Check, X, Plus, Pencil, Trash2 } from "lucide-react";
import clsx from "clsx";

interface Approval {
  id: string;
  type: string;
  entityId: string;
  status: string;
  payload: { action?: string; parameters?: Record<string, unknown> };
  createdAt: string;
}

interface AuditRow {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  userId: string | null;
  timestamp: string;
  source: string;
}

const TAB_CLASS =
  "px-3.5 py-2 text-[13px] font-medium text-ink-secondary data-[state=active]:text-brand-600 data-[state=active]:border-b-2 data-[state=active]:border-brand-500 -mb-px";

export default function SettingsPage() {
  return (
    <div className="pb-16">
      <PageHeader title="Settings" description="Workspace configuration, automation engine, and the audit trail." />
      <div className="px-5 md:px-8">
        <Tabs.Root defaultValue="engine">
          <Tabs.List className="flex gap-1 border-b border-black/10 dark:border-white/10 mb-5">
            <Tabs.Trigger value="engine" className={TAB_CLASS}>
              Follow-up Engine
            </Tabs.Trigger>
            <Tabs.Trigger value="followup-templates" className={TAB_CLASS}>
              Follow-up Templates
            </Tabs.Trigger>
            <Tabs.Trigger value="approvals" className={TAB_CLASS}>
              Approvals
            </Tabs.Trigger>
            <Tabs.Trigger value="audit" className={TAB_CLASS}>
              Audit Log
            </Tabs.Trigger>
            <Tabs.Trigger value="activation" className={TAB_CLASS}>
              Activation
            </Tabs.Trigger>
            <Tabs.Trigger value="credits" className={TAB_CLASS}>
              Credits &amp; Usage
            </Tabs.Trigger>
            <Tabs.Trigger value="ai-activity" className={TAB_CLASS}>
              AI Activity
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="engine" className="max-w-xl">
            <EngineTab />
          </Tabs.Content>
          <Tabs.Content value="followup-templates" className="max-w-2xl">
            <FollowUpTemplatesTab />
          </Tabs.Content>
          <Tabs.Content value="approvals" className="max-w-xl">
            <ApprovalsTab />
          </Tabs.Content>
          <Tabs.Content value="audit">
            <AuditTab />
          </Tabs.Content>
          <Tabs.Content value="activation" className="max-w-xl">
            <ActivationTab />
          </Tabs.Content>
          <Tabs.Content value="credits" className="max-w-xl">
            <CreditsTab />
          </Tabs.Content>
          <Tabs.Content value="ai-activity">
            <AIActivityTab />
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </div>
  );
}

function EngineTab() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    const res = await api.post<{ processed: number }>("/api/internal/followups/run");
    setResult(`Processed ${res.processed} due follow-up(s).`);
    setRunning(false);
  }

  return (
    <div className="card p-4 space-y-3">
      <p className="text-[13px] text-ink-primary font-medium">Background follow-up engine</p>
      <p className="text-[12.5px] text-ink-secondary">
        Runs automatically every 5 minutes via a BullMQ worker (<code>npm run worker</code>). Use this button to trigger a check immediately for testing/demo purposes.
      </p>
      <Button onClick={run} disabled={running}>
        <PlayCircle size={15} /> {running ? "Running…" : "Run now"}
      </Button>
      {result && <p className="text-[12.5px] text-status-good">{result}</p>}
    </div>
  );
}

interface FollowUpTemplate {
  id: string;
  name: string;
  messageBody: string;
  isActive: boolean;
}
interface SequenceStep {
  id: string;
  stepOrder: number;
  delayHours: number;
  template: { id: string; name: string; messageBody: string };
}
interface TemplateVariable {
  key: string;
  description: string;
}

// Follow-up Templates — modules/followups/templates.ts. Real messages
// the automated follow-up engine sends when a follow-up comes due
// (modules/followups/processor.ts), tenant-owned and editable here —
// replaces what used to be two strings hardcoded in that file. Never
// AI-generated: this is the "don't over-depend on AI for a routine
// re-engagement message" path.
function FollowUpTemplatesTab() {
  const [templates, setTemplates] = useState<FollowUpTemplate[]>([]);
  const [variables, setVariables] = useState<TemplateVariable[]>([]);
  const [steps, setSteps] = useState<SequenceStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<FollowUpTemplate | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [tRes, sRes] = await Promise.all([
      api.get<{ templates: FollowUpTemplate[]; availableVariables: TemplateVariable[] }>("/api/internal/followups/templates"),
      api.get<{ steps: SequenceStep[] }>("/api/internal/followups/sequence"),
    ]);
    setTemplates(tRes.templates);
    setVariables(tRes.availableVariables);
    setSteps(sRes.steps);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function deleteTemplate(id: string) {
    setError(null);
    try {
      await api.del(`/api/internal/followups/templates/${id}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  // Updates local state immediately (so typing feels responsive) but only
  // persists to the API when `save` is true — the select fires that on
  // every change (infrequent), the delay-hours number input fires it on
  // blur instead of every keystroke.
  function updateStepLocal(stepId: string, patch: Partial<{ templateId: string; delayHours: number }>): SequenceStep[] {
    const nextSteps = steps.map((s) => (s.id === stepId ? { ...s, template: patch.templateId ? { ...s.template, id: patch.templateId } : s.template, delayHours: patch.delayHours ?? s.delayHours } : s));
    setSteps(nextSteps);
    return nextSteps;
  }
  async function persistSteps(nextSteps: SequenceStep[]) {
    await api.patch("/api/internal/followups/sequence", {
      steps: nextSteps.map((s) => ({ stepId: s.id, templateId: s.template.id, delayHours: s.delayHours })),
    });
  }

  if (loading) return <p className="text-[12.5px] text-ink-muted">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="card p-4 space-y-3">
        <p className="text-[13px] text-ink-primary font-medium">Your follow-up sequence</p>
        <p className="text-[12.5px] text-ink-secondary">
          When an opportunity&apos;s follow-up comes due, this is what actually sends — no AI call, so it never depends on AI being available or affordable. Attempt 1 uses the first step below; every attempt after that repeats the last step.
        </p>
        <div className="space-y-2">
          {steps.map((s, i) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 border border-black/10 dark:border-white/10 rounded-lg p-3">
              <Badge tone="neutral">Attempt {i + 1}{i === steps.length - 1 ? "+" : ""}</Badge>
              <select
                value={s.template.id}
                onChange={(e) => persistSteps(updateStepLocal(s.id, { templateId: e.target.value }))}
                className="rounded-lg border border-black/10 dark:border-white/15 bg-surface px-2.5 py-1.5 text-[12.5px] text-ink-primary flex-1 min-w-[160px]"
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <span className="text-[12px] text-ink-muted">then wait</span>
              <div className="w-16">
                <Input
                  type="number"
                  min={1}
                  max={720}
                  value={s.delayHours}
                  onChange={(e) => updateStepLocal(s.id, { delayHours: Number(e.target.value) || 1 })}
                  onBlur={() => persistSteps(steps)}
                />
              </div>
              <span className="text-[12px] text-ink-muted">hours</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[13px] font-semibold text-ink-primary">Templates</p>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus size={13} /> New template
          </Button>
        </div>
        {error && <p className="text-[12.5px] text-status-critical mb-2">{error}</p>}
        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.id} className="card p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12.5px] font-medium text-ink-primary">{t.name}</p>
                <p className="text-[12px] text-ink-muted mt-0.5 line-clamp-2">{t.messageBody}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                  <Pencil size={13} />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => deleteTemplate(t.id)}>
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {editing && (
        <TemplateEditorDialog
          template={editing === "new" ? null : editing}
          variables={variables}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function TemplateEditorDialog({
  template,
  variables,
  onClose,
  onSaved,
}: {
  template: FollowUpTemplate | null;
  variables: TemplateVariable[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [messageBody, setMessageBody] = useState(template?.messageBody ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (template) await api.patch(`/api/internal/followups/templates/${template.id}`, { name, messageBody });
      else await api.post("/api/internal/followups/templates", { name, messageBody });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose} title={template ? "Edit template" : "New template"} description="This is a plain message, not an AI-generated one — it sends exactly as written.">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label>Name</Label>
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Second nudge" />
        </div>
        <div>
          <Label>Message</Label>
          <Textarea required rows={5} value={messageBody} onChange={(e) => setMessageBody(e.target.value)} placeholder="Hi {{contact_name}}, just checking in on {{objective}}..." />
          <p className="text-[11.5px] text-ink-muted mt-1.5">
            Variables: {variables.map((v) => `{{${v.key}}}`).join(", ")}
          </p>
        </div>
        {error && <p className="text-[12.5px] text-status-critical">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ApprovalsTab() {
  const [approvals, setApprovals] = useState<Approval[]>([]);

  async function load() {
    setApprovals(await api.get<Approval[]>("/api/internal/approvals"));
  }
  useEffect(() => {
    load();
  }, []);

  async function decide(id: string, decision: "APPROVED" | "REJECTED") {
    await api.patch(`/api/internal/approvals/${id}`, { decision });
    load();
  }

  return (
    <div className="space-y-2">
      <p className="text-[12.5px] text-ink-secondary mb-2">
        Actions your AI Sales Agent flagged as APPROVAL_REQUIRED (e.g. offering a discount) sit here until a human decides — the AI can never execute them on its own.
      </p>
      {approvals.length === 0 && <p className="text-[12.5px] text-ink-muted">No pending approvals.</p>}
      {approvals.map((a) => (
        <div key={a.id} className="card p-3 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-medium text-ink-primary">{a.payload.action ?? a.type}</p>
              <Badge tone="warning">Pending</Badge>
            </div>
            <p className="text-[11.5px] text-ink-muted">{new Date(a.createdAt).toLocaleString()}</p>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" onClick={() => decide(a.id, "APPROVED")}>
              <Check size={13} /> Approve
            </Button>
            <Button size="sm" variant="secondary" onClick={() => decide(a.id, "REJECTED")}>
              <X size={13} /> Reject
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function AuditTab() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  useEffect(() => {
    api.get<AuditRow[]>("/api/internal/audit").then(setRows).catch(() => setRows([]));
  }, []);

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-black/10 dark:border-white/10 text-left text-ink-muted text-[11px] uppercase tracking-wide">
            <th className="px-4 py-2.5 font-medium">Action</th>
            <th className="px-4 py-2.5 font-medium">Entity</th>
            <th className="px-4 py-2.5 font-medium">Source</th>
            <th className="px-4 py-2.5 font-medium">When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-black/[0.05] dark:border-white/[0.05]">
              <td className="px-4 py-2.5 text-ink-primary font-medium">{r.action}</td>
              <td className="px-4 py-2.5 text-ink-secondary">
                {r.entity} {r.entityId ? `· ${r.entityId.slice(0, 8)}` : ""}
              </td>
              <td className="px-4 py-2.5 text-ink-secondary">{r.source}</td>
              <td className="px-4 py-2.5 text-ink-muted">{new Date(r.timestamp).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="text-[12.5px] text-ink-muted p-4">No audit events yet.</p>}
    </div>
  );
}

interface OnboardingMetricsResponse {
  accountCreatedAt: string | null;
  ttfvSeconds: number | null;
  timeToGoLiveSeconds: number | null;
  timeToFirstSaleSeconds: number | null;
  currentStep: string | null;
  completedSteps: string[];
  completedAt: string | null;
  milestones: { event: string; occurredAt: string | null }[];
}

const MILESTONE_LABELS: Record<string, string> = {
  signup_completed: "Account created",
  workspace_created: "Workspace created",
  business_profile_completed: "Business profile completed",
  knowledge_import_completed: "Knowledge imported",
  agent_generated: "AI agent created",
  agent_test_completed: "Agent tested",
  channel_connected: "Channel connected",
  health_check_completed: "Health check passed",
  go_live_clicked: "Went live",
  agent_activated: "Agent activated",
  first_real_conversation: "First real conversation",
  first_contact_created: "First contact",
  first_lead_created: "First lead",
  first_qualified_lead: "First qualified lead",
  first_sale: "First sale",
  first_attributed_sale: "First attributed sale",
};

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

// docs/ONBOARDING_SPEC.md sections 20/33 — Time To First Value + funnel
// milestones. Tenant-scoped (see src/modules/onboarding/metrics.ts for
// why this isn't the spec's literal cross-tenant admin dashboard yet).
function ActivationTab() {
  const [data, setData] = useState<OnboardingMetricsResponse | null>(null);

  useEffect(() => {
    api.get<OnboardingMetricsResponse>("/api/internal/onboarding/metrics").then(setData).catch(() => setData(null));
  }, []);

  if (!data) return <p className="text-[12.5px] text-ink-muted">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-3">
          <p className="text-[11px] text-ink-muted uppercase tracking-wide">Time to First Value</p>
          <p className="text-[18px] font-semibold text-ink-primary mt-1">{formatDuration(data.ttfvSeconds)}</p>
          <p className="text-[10.5px] text-ink-muted mt-0.5">Signup → first real conversation</p>
        </div>
        <div className="card p-3">
          <p className="text-[11px] text-ink-muted uppercase tracking-wide">Time to Go Live</p>
          <p className="text-[18px] font-semibold text-ink-primary mt-1">{formatDuration(data.timeToGoLiveSeconds)}</p>
        </div>
        <div className="card p-3">
          <p className="text-[11px] text-ink-muted uppercase tracking-wide">Time to First Sale</p>
          <p className="text-[18px] font-semibold text-ink-primary mt-1">{formatDuration(data.timeToFirstSaleSeconds)}</p>
        </div>
      </div>
      <div className="card divide-y divide-black/[0.05] dark:divide-white/[0.05]">
        {data.milestones.map((m) => (
          <div key={m.event} className="px-4 py-2.5 flex items-center justify-between text-[12.5px]">
            <span className={m.occurredAt ? "text-ink-primary" : "text-ink-muted"}>{MILESTONE_LABELS[m.event] ?? m.event}</span>
            <span className="text-ink-muted">{m.occurredAt ? new Date(m.occurredAt).toLocaleString() : "Not yet"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface CreditLedgerRow {
  id: string;
  type: string;
  credits: number;
  balanceAfter: number;
  createdAt: string;
}

interface CreditsResponse {
  balance: number;
  plan: string;
  recent: CreditLedgerRow[];
  pricing: { freeTierGrant: number; paidTopupCredits: number; paidTopupPriceUsd: number };
}

interface CreditPackageOption {
  id: string;
  priceUsd: number;
  credits: number;
  custom: boolean;
}

interface AgentCostRow {
  agentId: string | null;
  agentName: string;
  runs: number;
  totalCostUsd: number;
  approxCredits: number;
}
interface UsageForecast {
  currentBalance: number;
  monthlyAllotment: number;
  reserveThreshold: number;
  avgDailyCredits7d: number;
  avgDailyCredits30d: number;
  projectedMonthlyCredits: number | null;
  daysOfRunway: number | null;
  byAgent: AgentCostRow[];
  reserveStatus: { tier: string; ok: boolean; reason?: string };
}

// Real Flutterwave mobile-money top-up (Master Product Architecture
// Update §26, §39) — modules/billing/topup.ts. Never shows provider cost,
// markup, or margin — just the price and the credits it buys, exactly
// the doc's own "Add AI Credits" example.
function AddCreditsDialog({ onClose }: { onClose: () => void }) {
  const [packages, setPackages] = useState<CreditPackageOption[]>([]);
  const [customMinUsd, setCustomMinUsd] = useState(15);
  const [selected, setSelected] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [network, setNetwork] = useState<"MTN" | "AIRTEL">("MTN");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ packages: CreditPackageOption[]; customMinUsd: number }>("/api/internal/billing/packages").then((res) => {
      setPackages(res.packages);
      setCustomMinUsd(res.customMinUsd);
      setSelected(res.packages.find((p) => !p.custom)?.id ?? null);
    });
  }, []);

  const customPkg = packages.find((p) => p.custom);
  const isCustom = selected === "custom";
  const customCredits = customPkg && customAmount ? Math.round((Number(customAmount) / customPkg.priceUsd) * customPkg.credits) : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (!selected) throw new Error("Choose an amount.");
      if (!phoneNumber.trim()) throw new Error("Enter your mobile money phone number.");
      const body: Record<string, unknown> = { packageId: selected, mobileMoneyNetwork: network, phoneNumber: phoneNumber.trim() };
      if (isCustom) {
        const amount = Number(customAmount);
        if (!amount || amount < customMinUsd) throw new Error(`Custom amount must be at least $${customMinUsd}.`);
        body.customAmountUsd = amount;
      }
      const res = await api.post<{ redirectUrl: string | null; isMock: boolean }>("/api/internal/billing/topup/initiate", body);
      if (res.redirectUrl) {
        window.location.href = res.redirectUrl;
      } else {
        setError("Payment started — check your phone to approve it, then refresh this page once complete.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start payment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose} title="Add AI Credits" description="Choose an amount. Paid via mobile money.">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {packages.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => setSelected(p.id)}
              className={clsx(
                "rounded-lg border px-3 py-2.5 text-left transition-colors",
                selected === p.id ? "border-brand-500 bg-brand-500/5" : "border-black/10 dark:border-white/15"
              )}
            >
              <p className="text-[13.5px] font-semibold text-ink-primary">{p.custom ? `Custom $${customMinUsd}+` : `$${p.priceUsd}`}</p>
              {!p.custom && <p className="text-[11.5px] text-ink-muted">{p.credits.toLocaleString()} credits</p>}
            </button>
          ))}
        </div>
        {isCustom && (
          <div>
            <Label>Amount (USD)</Label>
            <Input type="number" min={customMinUsd} step="1" value={customAmount} onChange={(e) => setCustomAmount(e.target.value)} placeholder={String(customMinUsd)} />
            {customCredits > 0 && <p className="text-[11.5px] text-ink-muted mt-1">You receive: {customCredits.toLocaleString()} AI Credits</p>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Mobile money network</Label>
            <select value={network} onChange={(e) => setNetwork(e.target.value as "MTN" | "AIRTEL")} className="w-full rounded-lg border border-black/10 dark:border-white/15 bg-surface px-3 py-2 text-[13.5px] text-ink-primary">
              <option value="MTN">MTN Mobile Money</option>
              <option value="AIRTEL">Airtel Money</option>
            </select>
          </div>
          <div>
            <Label>Phone number</Label>
            <Input required value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="7XXXXXXXX" />
          </div>
        </div>
        {error && <p className="text-[12.5px] text-status-critical">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting || !selected}>
            {submitting ? "Starting…" : "Continue"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// Usage forecast & reserve — modules/billing/forecast.ts +
// reserve-policy.ts. Every number here is real trailing usage, never a
// plan-based guess; "insufficient data yet" is shown honestly rather
// than a number extrapolated from one or two days of activity.
function UsageForecastCard() {
  const [forecast, setForecast] = useState<UsageForecast | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    api.get<UsageForecast>("/api/internal/billing/forecast").then(setForecast);
  }, []);

  if (!forecast) return null;

  const inReserve = forecast.currentBalance <= forecast.reserveThreshold;
  // "If enough historical data exists... Never show absurd calculations
  // such as '6993 days remaining.'" (Master Product Architecture Update
  // §32) — cap the displayed runway rather than show a huge number a
  // near-empty daily average produces.
  const runwayDisplay = forecast.daysOfRunway === null ? "Not enough usage yet to estimate." : forecast.daysOfRunway > 365 ? "365+ days" : `${forecast.daysOfRunway} days`;

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] font-semibold text-ink-primary">Live Conversation Protection</p>
        <Badge tone="good">ON</Badge>
      </div>
      <p className="text-[11.5px] text-ink-muted">We keep part of your available AI capacity protected for real customer conversations — those always keep working, even if your balance runs low.</p>
      {inReserve && (
        <p className="text-[11.5px] text-status-critical">Your balance has dropped into that protected range — agent-testing pauses until you top up, but live customer conversations are unaffected.</p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Estimated remaining use" value={runwayDisplay} />
        <Stat label="Projected this month" value={forecast.projectedMonthlyCredits === null ? "Not enough data yet" : `${forecast.projectedMonthlyCredits.toLocaleString()} credits`} />
      </div>
      <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="text-[11px] text-ink-muted underline decoration-dotted">
        {showAdvanced ? "Hide" : "Show"} advanced details
      </button>
      {showAdvanced && (
        <div className="grid grid-cols-2 gap-3 pt-1 border-t border-black/[0.06] dark:border-white/10">
          <Stat label="Avg credits / day (7d)" value={forecast.avgDailyCredits7d.toLocaleString()} />
          <Stat label="Reserved for live chats" value={forecast.reserveThreshold.toLocaleString()} />
        </div>
      )}
      {forecast.byAgent.length > 0 && (
        <div>
          <p className="text-[11px] text-ink-muted uppercase tracking-wide mb-1.5">Usage by agent (last 30 days)</p>
          <div className="space-y-1">
            {forecast.byAgent.map((a) => (
              <div key={a.agentId ?? "unassigned"} className="flex items-center justify-between text-[12px]">
                <span className="text-ink-secondary truncate">{a.agentName}</span>
                <span className="text-ink-muted tabular-nums shrink-0 ml-2">
                  {a.approxCredits.toLocaleString()} credits
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10.5px] text-ink-muted uppercase tracking-wide">{label}</p>
      <p className="text-[15px] font-semibold text-ink-primary tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

// AI usage credits — src/modules/billing/. Every row here is a real
// metered charge (or a real grant), never a placeholder number. No raw
// model/token/cost fields shown here — that moved to Platform Admin (see
// AIActivityTab's header comment); "Credits used" is all a tenant sees.
function CreditsTab() {
  const [data, setData] = useState<CreditsResponse | null>(null);
  const [addCreditsOpen, setAddCreditsOpen] = useState(false);

  async function load() {
    setData(await api.get<CreditsResponse>("/api/internal/billing/credits"));
  }
  useEffect(() => {
    load();
  }, []);

  if (!data) return <p className="text-[12.5px] text-ink-muted">Loading…</p>;

  const low = data.balance <= data.pricing.freeTierGrant * 0.1;

  return (
    <div className="space-y-4">
      <div className="card p-4 flex items-center justify-between">
        <div>
          <p className="text-[11px] text-ink-muted uppercase tracking-wide">AI Credits</p>
          <p className="text-[22px] font-semibold text-ink-primary mt-0.5">
            {data.balance.toLocaleString()} <span className="text-[13px] font-normal text-ink-muted">credits remaining</span>
          </p>
          <Badge tone={data.plan === "FREE" ? "neutral" : "brand"}>{data.plan === "FREE" ? "Free" : data.plan === "PRO" ? "Pro" : "Premium"}</Badge>
          <p className="text-[12px] text-ink-muted mt-2 max-w-xs">Credits power AI conversations, analysis, and AI actions.</p>
        </div>
        <Button onClick={() => setAddCreditsOpen(true)}>Add Credits</Button>
      </div>
      {low && (
        <div className="rounded-lg border border-status-critical/30 bg-status-critical/5 px-4 py-2.5 text-[12.5px] text-status-critical">
          Running low — once this reaches 0, your AI agent stops replying automatically and hands new conversations to a human until you top up.
        </div>
      )}
      <UsageForecastCard />
      <div>
        <p className="text-[12.5px] text-ink-secondary mb-2">Recent activity</p>
        <div className="card overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-black/10 dark:border-white/10 text-left text-ink-muted text-[11px] uppercase tracking-wide">
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Credits</th>
                <th className="px-4 py-2.5 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((r) => (
                <tr key={r.id} className="border-b border-black/[0.05] dark:border-white/[0.05]">
                  <td className="px-4 py-2.5 text-ink-primary font-medium">{r.type}</td>
                  <td className={clsx("px-4 py-2.5 font-medium", r.credits < 0 ? "text-status-critical" : "text-status-positive")}>
                    {r.credits > 0 ? "+" : ""}
                    {r.credits}
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">{new Date(r.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.recent.length === 0 && <p className="text-[12.5px] text-ink-muted p-4">No activity yet.</p>}
        </div>
      </div>
      {addCreditsOpen && <AddCreditsDialog onClose={() => setAddCreditsOpen(false)} />}
    </div>
  );
}

interface AIActivityRow {
  id: string;
  title: string;
  status: string;
  isFailure: boolean;
  credits: number;
  when: string;
}
interface AIActivityResponse {
  activity: AIActivityRow[];
  summary: { totalCreditsUsed: number; conversationCount: number; actionCount: number };
}

// Business-readable AI activity (Master Product Architecture Update
// §29-31) — backed by /api/internal/billing/ai-activity, which translates
// the same underlying AgentRun data the old raw "AI Runs" tab showed
// (model names, token counts, $ cost, stop reasons) into plain language
// and credits. The raw detail didn't go away — it moved to Platform Admin
// (/api/platform/tenants/[id]/ai-runs), which is the only place that data
// is meant to be visible per the doc's explicit rule.
function AIActivityTab() {
  const [data, setData] = useState<AIActivityResponse | null>(null);

  useEffect(() => {
    api.get<AIActivityResponse>("/api/internal/billing/ai-activity").then(setData);
  }, []);

  if (!data) return <p className="text-[12.5px] text-ink-muted">Loading…</p>;
  const { summary } = data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatChip label="AI Conversations" value={summary.conversationCount.toLocaleString()} />
        <StatChip label="AI Actions" value={summary.actionCount.toLocaleString()} />
        <StatChip label="Credits Used" value={summary.totalCreditsUsed.toLocaleString()} />
      </div>
      <div>
        <p className="text-[12.5px] text-ink-secondary mb-2">Recent activity</p>
        <div className="card overflow-hidden">
          {data.activity.length === 0 ? (
            <p className="text-[12.5px] text-ink-muted p-4">No AI activity yet.</p>
          ) : (
            data.activity.map((a) => (
              <div key={a.id} className="flex items-center justify-between px-4 py-2.5 border-b border-black/[0.05] dark:border-white/[0.05] last:border-0">
                <div>
                  <p className="text-[13px] text-ink-primary font-medium">{a.title}</p>
                  <p className="text-[11.5px] text-ink-muted">
                    {a.status} · {new Date(a.when).toLocaleString()}
                  </p>
                </div>
                {a.isFailure ? <Badge tone="critical">0 credits charged</Badge> : <Badge tone="neutral">{a.credits} credit{a.credits === 1 ? "" : "s"} used</Badge>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StatChip({ label, value, tone }: { label: string; value: string; tone?: "warning" }) {
  return (
    <div className={clsx("card p-3", tone === "warning" && "border-status-warning/40")}>
      <p className="text-[10.5px] text-ink-muted uppercase tracking-wide">{label}</p>
      <p className={clsx("text-[18px] font-semibold mt-0.5 tabular-nums", tone === "warning" ? "text-[#8a5a00]" : "text-ink-primary")}>{value}</p>
    </div>
  );
}
