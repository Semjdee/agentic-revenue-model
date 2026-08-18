"use client";

import { useEffect, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlayCircle, Check, X } from "lucide-react";

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
