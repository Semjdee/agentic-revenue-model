"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCardSkeleton, CardSkeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api-client";
import { formatCompactCurrency } from "@/lib/format";
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { AlertTriangle, Flame, Megaphone, Webhook, FileText, Sparkles, TrendingUp } from "lucide-react";

interface DashboardKpis {
  revenue: number;
  revenueTrendPct: number | null;
  openPipelineValue: number;
  openOpportunityCount: number;
  weightedPipelineValue: number;
  sales: number;
  salesTrendPct: number | null;
  qualifiedLeads: number;
  qualifiedLeadsTrendPct: number | null;
  conversations: number;
  conversationsTrendPct: number | null;
  advertisingSpend: number;
  advertisingSpendTrendPct: number | null;
  costPerLead: number;
  costPerSale: number;
  roas: number;
  roasTrendPct: number | null;
  aiHandled: number;
  humanHandled: number;
}
interface FunnelStage {
  key: string;
  label: string;
  count: number;
  pctOfTop: number | null;
}
interface ChannelRow {
  channel: string;
  conversations: number;
  qualified: number;
  sales: number;
  revenue: number;
  conversionPct: number | null;
}
interface SourceRow {
  source: string;
  conversations: number;
  qualified: number;
  sales: number;
  revenue: number;
  conversionPct: number | null;
}
interface DashboardData {
  kpis: DashboardKpis;
  revenueSeries: { date: string; value: number }[];
  funnel: { stages: FunnelStage[]; conversationToSaleConversionPct: number | null };
  channelPerformance: ChannelRow[];
  trafficSourcePerformance: SourceRow[];
  needsAttention: {
    hotLeads: number;
    overdueFollowUps: number;
    quotationsPendingCount: number;
    quotationsPendingValue: number;
    underperformingCampaigns: number;
    pendingRecommendations: number;
    failedWebhooks: number;
  };
  aiRevenueBrief: { headline: string; bullets: string[] };
}

const RANGES = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

const CHANNEL_LABELS: Record<string, string> = { WEBSITE: "Website", WHATSAPP: "WhatsApp", INSTAGRAM: "Instagram", MESSENGER: "Messenger" };

function fmtUGX(n: number) {
  return formatCompactCurrency(n, "UGX");
}

export default function DashboardPage() {
  const [range, setRange] = useState("7d");
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    setData(null);
    api.get<DashboardData>(`/api/internal/dashboard?range=${range}`).then(setData).catch(() => {});
  }, [range]);

  return (
    <div className="pb-12">
      <PageHeader
        title="Dashboard"
        description="Revenue intelligence across sales and marketing"
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

      <div className="px-5 md:px-8 space-y-4">
        {!data ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <KpiCardSkeleton primary />
              <KpiCardSkeleton primary />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <KpiCardSkeleton key={i} />
              ))}
            </div>
            <CardSkeleton height={80} />
            <div className="grid lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <CardSkeleton height={220} />
              </div>
              <CardSkeleton height={220} />
            </div>
          </>
        ) : (
          <>
            {/* Primary KPIs — doc §6/§35: Revenue and Open Pipeline get
                stronger visual weight than the activity metrics below. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <KpiCard size="primary" label="Revenue" value={fmtUGX(data.kpis.revenue)} trendPct={data.kpis.revenueTrendPct} />
              <KpiCard
                size="primary"
                label="Open Pipeline"
                value={fmtUGX(data.kpis.openPipelineValue)}
                subtitle={`${data.kpis.openOpportunityCount} opportunit${data.kpis.openOpportunityCount === 1 ? "y" : "ies"} · ${fmtUGX(data.kpis.weightedPipelineValue)} weighted`}
              />
            </div>

            {/* Secondary KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard label="Sales" value={String(data.kpis.sales)} trendPct={data.kpis.salesTrendPct} />
              <KpiCard label="Qualified Leads" value={String(data.kpis.qualifiedLeads)} trendPct={data.kpis.qualifiedLeadsTrendPct} />
              <KpiCard label="ROAS" value={`${data.kpis.roas.toFixed(1)}x`} tone={data.kpis.roas >= 3 ? "good" : undefined} trendPct={data.kpis.roasTrendPct} />
              <KpiCard label="Ad Spend" value={fmtUGX(data.kpis.advertisingSpend)} trendPct={data.kpis.advertisingSpendTrendPct} />
              <KpiCard label="Conversations" value={String(data.kpis.conversations)} trendPct={data.kpis.conversationsTrendPct} />
              <KpiCard label="Cost / Lead" value={fmtUGX(data.kpis.costPerLead)} />
              <KpiCard label="Cost / Sale" value={fmtUGX(data.kpis.costPerSale)} />
              <KpiCard label="AI vs Human" value={`${data.kpis.aiHandled} / ${data.kpis.humanHandled}`} hint="AI-handled / human-handled" />
            </div>

            {/* AI Revenue Brief — doc §8, built entirely from the real
                numbers above (modules/dashboard/brief.ts), never hardcoded. */}
            <div className="card p-4 border-brand-200 dark:border-brand-800/60 bg-gradient-to-br from-brand-50/60 to-transparent dark:from-brand-900/10">
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles size={14} className="text-brand-600" />
                <p className="text-[12.5px] font-semibold text-ink-primary">AI Revenue Brief</p>
              </div>
              <p className="text-[13.5px] text-ink-primary leading-relaxed">{data.aiRevenueBrief.headline}</p>
              {data.aiRevenueBrief.bullets.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {data.aiRevenueBrief.bullets.map((b, i) => (
                    <li key={i} className="text-[12.5px] text-ink-secondary leading-relaxed">
                      {b}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="grid lg:grid-cols-3 gap-4">
              <div className="card p-4 lg:col-span-2">
                <p className="text-[13px] font-semibold text-ink-primary mb-3">Revenue trend</p>
                {data.revenueSeries.length === 0 ? (
                  <EmptyState icon={TrendingUp} title="No sales recorded yet" description="Revenue will appear here as soon as your first sale closes in the selected period." />
                ) : (
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
                      <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => fmtUGX(Number(v))} />
                      <Tooltip formatter={(v: unknown) => fmtUGX(Number(Array.isArray(v) ? v[0] : v ?? 0))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                      <Area type="monotone" dataKey="value" stroke="#2a78d6" strokeWidth={2} fill="url(#revFill)" name="Revenue" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="card p-4">
                <p className="text-[13px] font-semibold text-ink-primary mb-3">Needs Attention</p>
                {Object.values(data.needsAttention).every((v) => !v) ? (
                  <p className="text-[12.5px] text-ink-muted py-2">Nothing needs your attention right now.</p>
                ) : (
                  <div className="space-y-1">
                    <AttentionRow icon={Flame} label="Hot leads waiting" value={data.needsAttention.hotLeads} tone="serious" href="/leads" />
                    <AttentionRow icon={AlertTriangle} label="Overdue follow-ups" value={data.needsAttention.overdueFollowUps} tone="warning" href="/followups" />
                    <AttentionRow
                      icon={FileText}
                      label="Quotations pending"
                      value={data.needsAttention.quotationsPendingCount}
                      detail={data.needsAttention.quotationsPendingValue > 0 ? fmtUGX(data.needsAttention.quotationsPendingValue) : undefined}
                      tone="brand"
                      href="/leads"
                    />
                    <AttentionRow icon={Megaphone} label="Campaigns below target ROAS" value={data.needsAttention.underperformingCampaigns} tone="warning" href="/advertising" />
                    <AttentionRow icon={Sparkles} label="AI recommendations awaiting approval" value={data.needsAttention.pendingRecommendations} tone="brand" href="/advertising" />
                    <AttentionRow icon={Webhook} label="Failed webhooks" value={data.needsAttention.failedWebhooks} tone="critical" href="/integrations" />
                  </div>
                )}
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <div className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[13px] font-semibold text-ink-primary">Lead Funnel</p>
                  {data.funnel.conversationToSaleConversionPct !== null && (
                    <span className="text-[11.5px] text-ink-muted">
                      Conversation → Sale: <span className="font-medium text-ink-primary tabular-nums">{data.funnel.conversationToSaleConversionPct.toFixed(1)}%</span>
                    </span>
                  )}
                </div>
                <div className="space-y-2.5">
                  {data.funnel.stages.map((s, i) => (
                    <div key={s.key}>
                      <div className="flex justify-between text-[11.5px] text-ink-secondary mb-1">
                        <span>{s.label}</span>
                        <span className="tabular-nums">
                          <span className="font-medium text-ink-primary">{s.count}</span>
                          {s.pctOfTop !== null && i > 0 && <span className="text-ink-muted ml-1.5">{s.pctOfTop.toFixed(0)}%</span>}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-black/[0.05] dark:bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${s.pctOfTop === null ? 4 : Math.max(4, s.pctOfTop)}%`, background: ["#2a78d6", "#3987e5", "#1baf7a", "#eda100", "#0ca30c"][i] }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card p-4">
                <p className="text-[13px] font-semibold text-ink-primary mb-3">Revenue by Source</p>
                {data.trafficSourcePerformance.length === 0 || data.trafficSourcePerformance.every((r) => r.revenue === 0) ? (
                  <EmptyState icon={TrendingUp} title="No attributed revenue yet" description="Revenue will break down by traffic source once sales are attributed to a campaign." />
                ) : (
                  <div className="space-y-2.5">
                    {data.trafficSourcePerformance.slice(0, 6).map((r) => {
                      const max = Math.max(...data.trafficSourcePerformance.map((x) => x.revenue), 1);
                      return (
                        <div key={r.source}>
                          <div className="flex justify-between text-[11.5px] text-ink-secondary mb-1">
                            <span>{r.source}</span>
                            <span className="tabular-nums font-medium text-ink-primary">{fmtUGX(r.revenue)}</span>
                          </div>
                          <div className="h-2 rounded-full bg-black/[0.05] dark:bg-white/10 overflow-hidden">
                            <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(2, (r.revenue / max) * 100)}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="card p-4">
              <p className="text-[13px] font-semibold text-ink-primary mb-3">Channel Performance</p>
              {data.channelPerformance.length === 0 ? (
                <EmptyState icon={Megaphone} title="No conversations yet in this period" description="Channel performance will appear here once customers start reaching out." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="border-b border-black/10 dark:border-white/10 text-left text-ink-muted text-[11px] uppercase tracking-wide">
                        <th className="py-2 pr-4 font-medium">Channel</th>
                        <th className="py-2 pr-4 font-medium text-right">Conversations</th>
                        <th className="py-2 pr-4 font-medium text-right">Qualified</th>
                        <th className="py-2 pr-4 font-medium text-right">Sales</th>
                        <th className="py-2 pr-4 font-medium text-right">Revenue</th>
                        <th className="py-2 font-medium text-right">Conversion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.channelPerformance.map((r) => (
                        <tr key={r.channel} className="border-b border-black/[0.05] dark:border-white/[0.05] hover:bg-black/[0.015] dark:hover:bg-white/[0.02]">
                          <td className="py-2.5 pr-4 text-ink-primary font-medium">{CHANNEL_LABELS[r.channel] ?? r.channel}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums text-ink-secondary">{r.conversations}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums text-ink-secondary">{r.qualified}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums text-ink-secondary">{r.sales}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums text-ink-primary font-medium">{fmtUGX(r.revenue)}</td>
                          <td className="py-2.5 text-right tabular-nums text-ink-secondary">{r.conversionPct === null ? "—" : `${r.conversionPct.toFixed(1)}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AttentionRow({
  icon: Icon,
  label,
  value,
  detail,
  tone,
  href,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  detail?: string;
  tone: "serious" | "warning" | "brand" | "critical";
  href: string;
}) {
  const colors: Record<string, string> = {
    serious: "text-status-serious bg-status-serious/10",
    warning: "text-[#8a5a00] bg-status-warning/15",
    brand: "text-brand-600 bg-brand-50 dark:bg-brand-900/30",
    critical: "text-status-critical bg-status-critical/10",
  };
  if (value === 0) return null;
  return (
    <a href={href} className="flex items-center gap-2.5 py-2 px-1.5 -mx-1.5 rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors">
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${colors[tone]}`}>
        <Icon size={13} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] text-ink-primary truncate">
          <span className="font-semibold tabular-nums">{value}</span> {label}
        </p>
        {detail && <p className="text-[11px] text-ink-muted">{detail}</p>}
      </div>
    </a>
  );
}
