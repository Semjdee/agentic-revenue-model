"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { api } from "@/lib/api-client";
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from "recharts";
import { AlertTriangle, Flame, Megaphone, Webhook } from "lucide-react";

interface DashboardData {
  kpis: {
    conversations: number;
    qualifiedLeads: number;
    sales: number;
    revenue: number;
    advertisingSpend: number;
    costPerLead: number;
    costPerSale: number;
    roas: number;
    aiHandled: number;
    humanHandled: number;
  };
  revenueSeries: { date: string; value: number }[];
  funnel: Record<string, number>;
  channelPerformance: { channel: string; count: number }[];
  trafficSourcePerformance: { source: string | null; count: number }[];
  needsAttention: { overdueFollowUps: number; hotLeads: number; pendingRecommendations: number; failedWebhooks: number };
}

const RANGES = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

function fmtUGX(n: number) {
  return "UGX " + Math.round(n).toLocaleString();
}

export default function DashboardPage() {
  const [range, setRange] = useState("7d");
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    api.get<DashboardData>(`/api/internal/dashboard?range=${range}`).then(setData).catch(() => {});
  }, [range]);

  const funnelStages = [
    { key: "NEW", label: "Conversations" },
    { key: "QUALIFIED", label: "Qualified" },
    { key: "QUOTATION", label: "Quotation" },
    { key: "WON", label: "Won" },
  ];

  return (
    <div className="pb-12">
      <PageHeader
        title="Dashboard"
        description="What's happening with my revenue operation today"
        actions={
          <div className="flex gap-1 bg-black/[0.04] dark:bg-white/10 rounded-lg p-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors ${
                  range === r.key ? "bg-surface shadow-sm text-ink-primary" : "text-ink-secondary"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      {!data ? (
        <div className="px-5 md:px-8 text-[13px] text-ink-muted">Loading…</div>
      ) : (
        <div className="px-5 md:px-8 space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
            <KpiCard label="Conversations" value={String(data.kpis.conversations)} />
            <KpiCard label="Qualified Leads" value={String(data.kpis.qualifiedLeads)} />
            <KpiCard label="Sales" value={String(data.kpis.sales)} />
            <KpiCard label="Revenue" value={fmtUGX(data.kpis.revenue)} />
            <KpiCard label="Ad Spend" value={fmtUGX(data.kpis.advertisingSpend)} />
            <KpiCard label="Cost / Lead" value={fmtUGX(data.kpis.costPerLead)} />
            <KpiCard label="Cost / Sale" value={fmtUGX(data.kpis.costPerSale)} />
            <KpiCard label="ROAS" value={`${data.kpis.roas.toFixed(1)}x`} tone={data.kpis.roas >= 3 ? "good" : undefined} />
            <KpiCard label="AI-handled" value={String(data.kpis.aiHandled)} />
            <KpiCard label="Human-handled" value={String(data.kpis.humanHandled)} />
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <div className="card p-4 lg:col-span-2">
              <p className="text-[13px] font-semibold text-ink-primary mb-3">Revenue over selected period</p>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data.revenueSeries}>
                  <defs>
                    <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2a78d6" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#2a78d6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--gridline)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={{ stroke: "var(--gridline)" }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip formatter={(v: unknown) => fmtUGX(Number(Array.isArray(v) ? v[0] : v ?? 0))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Area type="monotone" dataKey="value" stroke="#2a78d6" strokeWidth={2} fill="url(#revFill)" name="Revenue" />
                </AreaChart>
              </ResponsiveContainer>
              {data.revenueSeries.length === 0 && <p className="text-[12px] text-ink-muted text-center -mt-32">No sales recorded in this period yet.</p>}
            </div>

            <div className="card p-4">
              <p className="text-[13px] font-semibold text-ink-primary mb-3">Lead Funnel</p>
              <div className="space-y-2.5">
                {funnelStages.map((s, i) => {
                  const value = data.funnel[s.key] ?? 0;
                  const max = Math.max(1, data.funnel["NEW"] ?? 1);
                  return (
                    <div key={s.key}>
                      <div className="flex justify-between text-[11.5px] text-ink-secondary mb-1">
                        <span>{s.label}</span>
                        <span className="tabular-nums font-medium text-ink-primary">{value}</span>
                      </div>
                      <div className="h-2 rounded-full bg-black/[0.05] dark:bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.max(4, (value / max) * 100)}%`, background: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"][i] }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="card p-4">
              <p className="text-[13px] font-semibold text-ink-primary mb-3">Channel Performance</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={data.channelPerformance} layout="vertical" margin={{ left: 8 }}>
                  <XAxis type="number" hide />
                  <YAxis dataKey="channel" type="category" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} axisLine={false} tickLine={false} width={90} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="count" fill="#2a78d6" radius={[0, 4, 4, 0]} barSize={16} name="Conversations" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="card p-4">
              <p className="text-[13px] font-semibold text-ink-primary mb-3">Traffic Source Performance</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={data.trafficSourcePerformance.map((r) => ({ ...r, source: r.source || "Direct" }))} layout="vertical" margin={{ left: 8 }}>
                  <XAxis type="number" hide />
                  <YAxis dataKey="source" type="category" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} axisLine={false} tickLine={false} width={90} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="count" fill="#eb6834" radius={[0, 4, 4, 0]} barSize={16} name="Conversations" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card p-4">
            <p className="text-[13px] font-semibold text-ink-primary mb-3">Needs Attention</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <AttentionItem icon={Flame} label="Hot leads waiting" value={data.needsAttention.hotLeads} tone="serious" />
              <AttentionItem icon={AlertTriangle} label="Overdue follow-ups" value={data.needsAttention.overdueFollowUps} tone="warning" />
              <AttentionItem icon={Megaphone} label="Ad recommendations" value={data.needsAttention.pendingRecommendations} tone="brand" />
              <AttentionItem icon={Webhook} label="Failed webhooks" value={data.needsAttention.failedWebhooks} tone="critical" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AttentionItem({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: number; tone: "serious" | "warning" | "brand" | "critical" }) {
  const colors: Record<string, string> = {
    serious: "text-status-serious bg-status-serious/10",
    warning: "text-[#8a5a00] bg-status-warning/15",
    brand: "text-brand-600 bg-brand-50",
    critical: "text-status-critical bg-status-critical/10",
  };
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-black/[0.02] dark:bg-white/[0.03]">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors[tone]}`}>
        <Icon size={15} />
      </div>
      <div>
        <p className="text-[16px] font-semibold text-ink-primary tabular-nums leading-none">{value}</p>
        <p className="text-[11px] text-ink-muted mt-0.5">{label}</p>
      </div>
    </div>
  );
}
