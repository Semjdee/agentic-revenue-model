"use client";

import { useEffect, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlayCircle, Check, X } from "lucide-react";
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
          </Tabs.List>

          <Tabs.Content value="engine" className="max-w-xl">
            <EngineTab />
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
