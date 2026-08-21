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
            <Tabs.Trigger value="ai-runs" className={TAB_CLASS}>
              AI Runs
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
          <Tabs.Content value="ai-runs">
            <AIRunsTab />
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
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: string | null;
  reason: string;
  createdAt: string;
}

interface CreditsResponse {
  balance: number;
  plan: string;
  recent: CreditLedgerRow[];
  pricing: { freeTierGrant: number; paidTopupCredits: number; paidTopupPriceUsd: number };
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

// Usage forecast & reserve — modules/billing/forecast.ts +
// reserve-policy.ts. Every number here is real trailing usage, never a
// plan-based guess; "insufficient data yet" is shown honestly rather
// than a number extrapolated from one or two days of activity.
function UsageForecastCard() {
  const [forecast, setForecast] = useState<UsageForecast | null>(null);

  useEffect(() => {
    api.get<UsageForecast>("/api/internal/billing/forecast").then(setForecast);
  }, []);

  if (!forecast) return null;

  const inReserve = forecast.currentBalance <= forecast.reserveThreshold;

  return (
    <div className="card p-4 space-y-3">
      <p className="text-[12.5px] font-semibold text-ink-primary">Usage forecast &amp; reserve</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Avg / day (7d)" value={forecast.avgDailyCredits7d.toLocaleString()} />
        <Stat label="Projected this month" value={forecast.projectedMonthlyCredits === null ? "Not enough data yet" : forecast.projectedMonthlyCredits.toLocaleString()} />
        <Stat label="Days of runway" value={forecast.daysOfRunway === null ? "—" : `${forecast.daysOfRunway}d`} />
        <Stat label="Reserved for live chats" value={forecast.reserveThreshold.toLocaleString()} />
      </div>
      <p className="text-[11.5px] text-ink-muted">
        {inReserve
          ? "Your balance has dropped into the reserve that protects live customer conversations — those keep working regardless; agent-testing pauses until you top up."
          : "Live customer conversations are always kept working first. A reserve is held back so a busy testing session in the agent builder can never take those down — see the Special AI Notes in the build docs for the full policy."}
      </p>
      {forecast.byAgent.length > 0 && (
        <div>
          <p className="text-[11px] text-ink-muted uppercase tracking-wide mb-1.5">Cost by agent (last 30 days)</p>
          <div className="space-y-1">
            {forecast.byAgent.map((a) => (
              <div key={a.agentId ?? "unassigned"} className="flex items-center justify-between text-[12px]">
                <span className="text-ink-secondary truncate">{a.agentName}</span>
                <span className="text-ink-muted tabular-nums shrink-0 ml-2">
                  {a.runs} run{a.runs === 1 ? "" : "s"} · ~{a.approxCredits.toLocaleString()} credits
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
// metered charge (or a real grant), never a placeholder number.
function CreditsTab() {
  const [data, setData] = useState<CreditsResponse | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [requestMsg, setRequestMsg] = useState<string | null>(null);

  async function load() {
    setData(await api.get<CreditsResponse>("/api/internal/billing/credits"));
  }
  useEffect(() => {
    load();
  }, []);

  async function requestTopup() {
    setRequesting(true);
    setRequestMsg(null);
    try {
      const res = await api.post<{ message: string }>("/api/internal/billing/request-topup");
      setRequestMsg(res.message);
    } finally {
      setRequesting(false);
    }
  }

  if (!data) return <p className="text-[12.5px] text-ink-muted">Loading…</p>;

  const low = data.balance <= data.pricing.freeTierGrant * 0.1;

  return (
    <div className="space-y-4">
      <div className="card p-4 flex items-center justify-between">
        <div>
          <p className="text-[11px] text-ink-muted uppercase tracking-wide">Balance</p>
          <p className="text-[22px] font-semibold text-ink-primary mt-0.5">
            {data.balance.toLocaleString()} <span className="text-[13px] font-normal text-ink-muted">credits</span>
          </p>
          <Badge tone={data.plan === "PAID" ? "brand" : "neutral"}>{data.plan === "PAID" ? "Paid" : "Free tier"}</Badge>
        </div>
        <div className="text-right">
          <Button onClick={requestTopup} disabled={requesting}>
            {requesting ? "Requesting…" : `Buy ${data.pricing.paidTopupCredits.toLocaleString()} credits — $${data.pricing.paidTopupPriceUsd}`}
          </Button>
          {requestMsg && <p className="text-[11.5px] text-ink-muted mt-1.5 max-w-[220px]">{requestMsg}</p>}
        </div>
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
                <th className="px-4 py-2.5 font-medium">Model</th>
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
                  <td className="px-4 py-2.5 text-ink-secondary">{r.model ?? "—"}</td>
                  <td className="px-4 py-2.5 text-ink-muted">{new Date(r.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.recent.length === 0 && <p className="text-[12.5px] text-ink-muted p-4">No activity yet.</p>}
        </div>
      </div>
    </div>
  );
}

interface AgentRunRow {
  id: string;
  triggerType: string;
  status: string;
  modelCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: string;
  stopReason: string | null;
  startedAt: string;
}
interface AIRunsResponse {
  recent: AgentRunRow[];
  stats: {
    totalRuns: number;
    completed: number;
    stoppedLimit: number;
    stoppedLoop: number;
    timedOut: number;
    failed: number;
    totalCostUsd: string;
    avgToolCalls: string;
  };
}

const RUN_STATUS_TONE: Record<string, "good" | "warning" | "critical" | "neutral" | "brand"> = {
  COMPLETED: "good",
  RUNNING: "brand",
  STOPPED_LIMIT: "warning",
  STOPPED_LOOP: "warning",
  TIMED_OUT: "critical",
  FAILED: "critical",
  CANCELLED: "neutral",
};

// AIExecutionGateway observability (multi-agent-routing spec Part B
// §39-40) — every AgentRun src/modules/ai/execution-gateway.ts produces,
// so a business owner can see at a glance whether their AI is behaving:
// what it's costing, and whether any runs got cut off for looping or
// hitting a limit rather than genuinely completing.
function AIRunsTab() {
  const [data, setData] = useState<AIRunsResponse | null>(null);

  useEffect(() => {
    api.get<AIRunsResponse>("/api/internal/ai/runs").then(setData);
  }, []);

  if (!data) return <p className="text-[12.5px] text-ink-muted">Loading…</p>;
  const { stats } = data;
  const guardedRuns = stats.stoppedLimit + stats.stoppedLoop + stats.timedOut;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatChip label="Total runs" value={stats.totalRuns.toLocaleString()} />
        <StatChip label="Est. AI spend" value={`$${Number(stats.totalCostUsd).toFixed(4)}`} />
        <StatChip label="Avg tool calls / run" value={Number(stats.avgToolCalls).toFixed(1)} />
        <StatChip label="Guarded (limit/loop/timeout)" value={guardedRuns.toLocaleString()} tone={guardedRuns > 0 ? "warning" : undefined} />
      </div>
      <p className="text-[11.5px] text-ink-muted">
        Every AI reply is bounded by the AIExecutionGateway — hard, backend-enforced caps on tool calls, tokens, cost, and time per run, so a
        misbehaving conversation can&apos;t run up unbounded cost. &quot;Guarded&quot; runs are ones those caps actually stepped in on.
      </p>
      <div>
        <p className="text-[12.5px] text-ink-secondary mb-2">Recent runs</p>
        <div className="card overflow-hidden overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-black/10 dark:border-white/10 text-left text-ink-muted text-[11px] uppercase tracking-wide">
                <th className="px-4 py-2.5 font-medium">Trigger</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Tool calls</th>
                <th className="px-4 py-2.5 font-medium">Tokens</th>
                <th className="px-4 py-2.5 font-medium">Cost</th>
                <th className="px-4 py-2.5 font-medium">Stop reason</th>
                <th className="px-4 py-2.5 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((r) => (
                <tr key={r.id} className="border-b border-black/[0.05] dark:border-white/[0.05]">
                  <td className="px-4 py-2.5 text-ink-secondary">{r.triggerType}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={RUN_STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-ink-secondary tabular-nums">{r.toolCalls}</td>
                  <td className="px-4 py-2.5 text-ink-secondary tabular-nums">{(r.inputTokens + r.outputTokens).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-ink-secondary tabular-nums">${Number(r.estimatedCostUsd).toFixed(4)}</td>
                  <td className="px-4 py-2.5 text-ink-muted truncate max-w-[220px]" title={r.stopReason ?? undefined}>
                    {r.stopReason ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">{new Date(r.startedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.recent.length === 0 && <p className="text-[12.5px] text-ink-muted p-4">No AI runs yet.</p>}
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
