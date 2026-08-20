"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlayCircle } from "lucide-react";

interface Opportunity {
  id: string;
  contactId: string;
  stage: string;
  nextFollowUpAt: string | null;
  followUpAttempts: number;
  followUpObjective: string | null;
  aiFollowUpEnabled: boolean;
}

export default function FollowUpsPage() {
  const [overdue, setOverdue] = useState<Opportunity[]>([]);
  const [upcoming, setUpcoming] = useState<Opportunity[]>([]);
  const [contactNames, setContactNames] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);

  async function load() {
    const contacts = await api.get<{ id: string; name: string | null; phone: string | null }[]>("/api/internal/contacts");
    const map: Record<string, string> = {};
    for (const c of contacts) map[c.id] = c.name || c.phone || "Anonymous";
    setContactNames(map);
  }

  useEffect(() => {
    load();
    fetchOpportunities();
  }, []);

  // Same overdue/upcoming split the Dashboard's "Needs Attention" panel
  // counts from (src/modules/followups/service.ts) — computed server-side
  // once, not re-derived here, so the two pages can't disagree.
  async function fetchOpportunities() {
    const queue = await api.get<{ overdue: Opportunity[]; upcoming: Opportunity[] }>("/api/internal/followups");
    setOverdue(queue.overdue);
    setUpcoming(queue.upcoming);
  }

  async function runNow() {
    setRunning(true);
    const res = await api.post<{ processed: number }>("/api/internal/followups/run");
    setLastRun(`Processed ${res.processed} due follow-up(s) just now.`);
    setRunning(false);
    fetchOpportunities();
  }

  return (
    <div className="pb-12">
      <PageHeader
        title="Follow-ups"
        description="Automated re-engagement for open opportunities — stops on Won, Lost, opt-out, or max attempts."
        actions={
          <Button onClick={runNow} disabled={running}>
            <PlayCircle size={15} /> {running ? "Running…" : "Run follow-up check now"}
          </Button>
        }
      />
      <div className="px-5 md:px-8 space-y-6">
        {lastRun && <p className="text-[12.5px] text-status-good">{lastRun}</p>}

        <Section title={`Overdue (${overdue.length})`} rows={overdue} contactNames={contactNames} tone="critical" />
        <Section title={`Upcoming (${upcoming.length})`} rows={upcoming} contactNames={contactNames} tone="neutral" />
      </div>
    </div>
  );
}

function Section({ title, rows, contactNames, tone }: { title: string; rows: Opportunity[]; contactNames: Record<string, string>; tone: "critical" | "neutral" }) {
  return (
    <div>
      <p className="text-[13px] font-semibold text-ink-primary mb-2">{title}</p>
      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <p className="text-[12.5px] text-ink-muted p-4">Nothing here.</p>
        ) : (
          rows.map((o) => (
            <div key={o.id} className="flex items-center justify-between px-4 py-2.5 border-b border-black/[0.05] dark:border-white/[0.05] last:border-0">
              <div>
                <p className="text-[13px] text-ink-primary font-medium">{contactNames[o.contactId] || "Contact"}</p>
                <p className="text-[11.5px] text-ink-muted">{o.followUpObjective || "Follow up"}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={tone === "critical" ? "critical" : "neutral"}>{o.nextFollowUpAt && new Date(o.nextFollowUpAt).toLocaleString()}</Badge>
                <Badge tone="neutral">Attempt {o.followUpAttempts + 1}/3</Badge>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
