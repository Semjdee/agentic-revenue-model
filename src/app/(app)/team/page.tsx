"use client";

import { useEffect, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { ROLES, type Role } from "@/db/schema";

interface Member {
  id: string;
  name: string;
  // Nullable — a member who signed up or was linked via phone/Google/Apple
  // may have no password-auth email (see users.email in db/schema.ts).
  email: string | null;
  role: Role;
  active: boolean;
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
}

interface SeatAvailability {
  plan: "FREE" | "PRO" | "PREMIUM";
  used: number;
  included: number;
  extra: number;
  atOrOverIncluded: boolean;
}

const STATUS_TONE: Record<Member["status"], "good" | "neutral" | "warning"> = {
  ACTIVE: "good",
  INVITED: "neutral",
  SUSPENDED: "warning",
  DEACTIVATED: "neutral",
};
const STATUS_LABEL: Record<Member["status"], string> = {
  ACTIVE: "Active",
  INVITED: "Invited",
  SUSPENDED: "Suspended",
  DEACTIVATED: "Deactivated",
};

const TAB_CLASS =
  "px-3.5 py-2 text-[13px] font-medium text-ink-secondary data-[state=active]:text-brand-600 data-[state=active]:border-b-2 data-[state=active]:border-brand-500 -mb-px";

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [seats, setSeats] = useState<SeatAvailability | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "SALES" as Role });
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  async function load() {
    const res = await api.get<{ members: Member[]; seats: SeatAvailability }>("/api/internal/team");
    setMembers(res.members);
    setSeats(res.seats);
  }
  useEffect(() => {
    load();
  }, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    try {
      const res = await api.post<{ temporaryPassword: string }>("/api/internal/team", form);
      setTempPassword(res.temporaryPassword);
      load();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Could not send that invite");
    }
  }

  async function changeRole(id: string, role: Role) {
    await api.patch(`/api/internal/team/${id}`, { role });
    load();
  }

  const seatLimitReached = seats?.atOrOverIncluded && seats.plan === "FREE";

  return (
    <div className="pb-12">
      <PageHeader
        title="Team"
        description="Manage who has access and what they can do. Everyone shares the same AI credit pool."
        actions={
          <Button
            onClick={() => {
              setOpen(true);
              setTempPassword(null);
              setInviteError(null);
            }}
          >
            <Plus size={15} /> Invite teammate
          </Button>
        }
      />
      <div className="px-5 md:px-8 space-y-4">
        {seats && (
          <div className="card p-3.5 flex items-center justify-between">
            <div>
              <p className="text-[12.5px] font-medium text-ink-primary">
                {seats.used} of {seats.included} seats used
                {seats.extra > 0 && <span className="text-ink-muted"> ({seats.extra} extra, ${5 * seats.extra}/mo)</span>}
              </p>
              {seatLimitReached && (
                <p className="text-[11.5px] text-status-critical mt-0.5">
                  Free plan is at its seat limit — upgrade to Pro or Premium to invite more teammates.
                </p>
              )}
            </div>
            <Badge tone={seatLimitReached ? "critical" : "neutral"}>{seats.plan}</Badge>
          </div>
        )}

        <Tabs.Root defaultValue="members">
          <Tabs.List className="flex gap-1 border-b border-black/10 dark:border-white/10 mb-4">
            <Tabs.Trigger value="members" className={TAB_CLASS}>
              Members
            </Tabs.Trigger>
            <Tabs.Trigger value="performance" className={TAB_CLASS}>
              Performance
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="members">
            <div className="card overflow-hidden">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-black/10 dark:border-white/10 text-left text-ink-muted text-[11.5px] uppercase tracking-wide">
                    <th className="px-4 py-2.5 font-medium">Name</th>
                    <th className="px-4 py-2.5 font-medium">Email</th>
                    <th className="px-4 py-2.5 font-medium">Role</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id} className="border-b border-black/[0.05] dark:border-white/[0.05]">
                      <td className="px-4 py-2.5 text-ink-primary font-medium">{m.name}</td>
                      <td className="px-4 py-2.5 text-ink-secondary">{m.email || "—"}</td>
                      <td className="px-4 py-2.5">
                        <select
                          value={m.role}
                          onChange={(e) => changeRole(m.id, e.target.value as Role)}
                          className="rounded-md border border-black/10 dark:border-white/15 bg-surface px-2 py-1 text-[12.5px]"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Tabs.Content>

          <Tabs.Content value="performance">
            <TeamPerformanceTab />
          </Tabs.Content>
        </Tabs.Root>
      </div>

      <Dialog open={open} onOpenChange={setOpen} title="Invite teammate">
        {tempPassword ? (
          <div className="space-y-3">
            <p className="text-[12.5px] text-ink-secondary">No email delivery configured in this MVP — share this temporary password with them directly.</p>
            <pre className="bg-black text-white text-[12px] rounded-lg p-3">{tempPassword}</pre>
            <Button className="w-full" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={invite} className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>Email</Label>
              <Input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <Label>Role</Label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                className="w-full rounded-lg border border-black/10 dark:border-white/15 bg-surface px-3 py-2 text-[13.5px]"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            {inviteError && <p className="text-[12.5px] text-status-critical">{inviteError}</p>}
            <Button type="submit" className="w-full">
              Send invite
            </Button>
          </form>
        )}
      </Dialog>
    </div>
  );
}

interface MemberPerformance {
  userId: string;
  name: string;
  leadsAssigned: number;
  leadsContacted: number;
  opportunities: number;
  wonOpportunities: number;
  wonRevenue: number;
  conversionPct: number | null;
  avgDealSize: number | null;
  avgSalesCycleDays: number | null;
  tasksCompleted: number;
  tasksOpen: number;
}

// modules/team/performance.ts — real aggregates over existing
// assignedUserId/owner columns, last 30 days. No AI-invented numbers.
function TeamPerformanceTab() {
  const [rows, setRows] = useState<MemberPerformance[] | null>(null);

  useEffect(() => {
    api.get<{ performance: MemberPerformance[] }>("/api/internal/team/performance").then((r) => setRows(r.performance));
  }, []);

  if (!rows) return <p className="text-[13px] text-ink-muted">Loading…</p>;

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10 text-left text-ink-muted text-[11px] uppercase tracking-wide">
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium text-right">Leads</th>
              <th className="px-4 py-2.5 font-medium text-right">Contacted</th>
              <th className="px-4 py-2.5 font-medium text-right">Opportunities</th>
              <th className="px-4 py-2.5 font-medium text-right">Won</th>
              <th className="px-4 py-2.5 font-medium text-right">Revenue</th>
              <th className="px-4 py-2.5 font-medium text-right">Conversion</th>
              <th className="px-4 py-2.5 font-medium text-right">Avg deal</th>
              <th className="px-4 py-2.5 font-medium text-right">Open tasks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId} className="border-b border-black/[0.05] dark:border-white/[0.05]">
                <td className="px-4 py-2.5 text-ink-primary font-medium">{r.name}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-secondary">{r.leadsAssigned}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-secondary">{r.leadsContacted}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-secondary">{r.opportunities}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-secondary">{r.wonOpportunities}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-primary font-medium">{r.wonRevenue.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-secondary">{r.conversionPct === null ? "—" : `${r.conversionPct.toFixed(0)}%`}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-secondary">{r.avgDealSize === null ? "—" : r.avgDealSize.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-secondary">{r.tasksOpen}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
