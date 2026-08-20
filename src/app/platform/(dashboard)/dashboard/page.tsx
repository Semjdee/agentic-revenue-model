"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

interface DashboardData {
  stats: {
    totalTenants: number;
    activeTenants30d: number;
    totalUsers: number;
    creditsConsumed: number;
    aiProviderCostUsd: number;
    tenantsApproachingLimits: number;
    failedIntegrations: number;
    aiConversationsToday: number;
    mrrUsd: number | null;
    proSubscriptions: number;
    billingTracked: boolean;
  };
  funnel: Record<string, number>;
  tenants: {
    id: string;
    name: string;
    createdAt: string;
    plan: string;
    creditBalance: number;
    onboardingStep: string | null;
    wentLive: boolean;
  }[];
}

const FUNNEL_LABELS: Record<string, string> = {
  ACCOUNT: "Account created",
  BUSINESS_PROFILE: "Business profile",
  KNOWLEDGE_IMPORT: "Knowledge imported",
  AGENT_SETUP: "Agent set up",
  AGENT_TEST: "Agent tested",
  CHANNEL_CONNECT: "Channel connected",
  HEALTH_CHECK: "Health check passed",
  GO_LIVE: "Went live",
};

export default function PlatformDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    api.get<DashboardData>("/api/platform/dashboard").then(setData);
  }, []);

  if (!data) return <p className="text-[13px] text-white/50">Loading…</p>;
  const { stats } = data;
  const funnelMax = Math.max(1, ...Object.values(data.funnel));

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-[18px] font-semibold text-white">Platform Dashboard</h1>
        <p className="text-[12.5px] text-white/50 mt-0.5">Cross-tenant view — every business on the platform, in one place.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Tile label="Total tenants" value={stats.totalTenants.toLocaleString()} />
        <Tile label="Active tenants (30d)" value={stats.activeTenants30d.toLocaleString()} />
        <Tile label="Total users" value={stats.totalUsers.toLocaleString()} />
        <Tile label="AI conversations today" value={stats.aiConversationsToday.toLocaleString()} />
        <Tile label="AI credits consumed" value={stats.creditsConsumed.toLocaleString()} />
        <Tile label="AI provider cost" value={`$${stats.aiProviderCostUsd.toFixed(2)}`} />
        <Tile label="Tenants approaching limits" value={stats.tenantsApproachingLimits.toLocaleString()} tone={stats.tenantsApproachingLimits > 0 ? "warning" : undefined} />
        <Tile label="Failed integrations" value={stats.failedIntegrations.toLocaleString()} tone={stats.failedIntegrations > 0 ? "critical" : undefined} />
        <Tile label="Pro subscriptions" value={stats.proSubscriptions.toLocaleString()} caption={!stats.billingTracked ? "no recurring billing wired up yet" : undefined} />
        <Tile label="MRR" value={stats.mrrUsd === null ? "—" : `$${stats.mrrUsd.toFixed(2)}`} caption={!stats.billingTracked ? "no recurring billing wired up yet" : undefined} />
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <p className="text-[13px] font-semibold text-white mb-3">Onboarding funnel (all tenants)</p>
        <div className="space-y-2">
          {Object.entries(data.funnel).map(([step, count]) => (
            <div key={step}>
              <div className="flex justify-between text-[12px] text-white/60 mb-1">
                <span>{FUNNEL_LABELS[step] ?? step}</span>
                <span className="tabular-nums text-white/90 font-medium">{count}</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(2, (count / funnelMax) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
        <p className="text-[13px] font-semibold text-white p-4 pb-2">Tenants</p>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-white/10 text-left text-white/40 text-[11px] uppercase tracking-wide">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Plan</th>
                <th className="px-4 py-2 font-medium">Credits</th>
                <th className="px-4 py-2 font-medium">Onboarding</th>
                <th className="px-4 py-2 font-medium">Live?</th>
                <th className="px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {data.tenants.map((t) => (
                <tr key={t.id} className="border-b border-white/5">
                  <td className="px-4 py-2 text-white font-medium">{t.name}</td>
                  <td className="px-4 py-2 text-white/70">{t.plan}</td>
                  <td className={`px-4 py-2 tabular-nums ${t.creditBalance <= 100 ? "text-amber-400" : "text-white/70"}`}>{t.creditBalance.toLocaleString()}</td>
                  <td className="px-4 py-2 text-white/70">{t.onboardingStep ? FUNNEL_LABELS[t.onboardingStep] ?? t.onboardingStep : "—"}</td>
                  <td className="px-4 py-2">{t.wentLive ? <span className="text-emerald-400">Yes</span> : <span className="text-white/40">No</span>}</td>
                  <td className="px-4 py-2 text-white/50">{new Date(t.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, tone, caption }: { label: string; value: string; tone?: "warning" | "critical"; caption?: string }) {
  const color = tone === "critical" ? "text-red-400" : tone === "warning" ? "text-amber-400" : "text-white";
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <p className="text-[10.5px] text-white/40 uppercase tracking-wide">{label}</p>
      <p className={`text-[20px] font-semibold mt-0.5 tabular-nums ${color}`}>{value}</p>
      {caption && <p className="text-[10px] text-white/30 mt-0.5">{caption}</p>}
    </div>
  );
}
