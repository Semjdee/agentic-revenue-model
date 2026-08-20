"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";

interface AssistedRow {
  source: string;
  closedConversions: number;
  closedRevenue: number;
  assistedConversions: number;
  assistedRevenue: number;
}
interface AttributionData {
  revenueBySource: { source: string; revenue: number }[];
  revenueByCampaign: { campaign: string; revenue: number }[];
  touches: { id: string; touchType: string; source: string | null; campaign: string | null; createdAt: string }[];
  assisted: AssistedRow[];
}
interface OrganicSearchData {
  connected: boolean;
  propertyName?: string;
  totalImpressions?: number;
  totalClicks?: number;
  avgPosition?: number;
  topQueries?: { query: string; clicks: number; impressions: number }[];
}

function fmtUGX(n: number) {
  return "UGX " + Math.round(n).toLocaleString();
}

export default function AttributionPage() {
  const [data, setData] = useState<AttributionData | null>(null);
  const [organic, setOrganic] = useState<OrganicSearchData | null>(null);

  useEffect(() => {
    api.get<AttributionData>("/api/internal/attribution").then(setData);
    api.get<OrganicSearchData>("/api/internal/analytics/organic-search").then(setOrganic);
  }, []);

  return (
    <div className="pb-12">
      <PageHeader title="Attribution" description="Which campaign generated this customer, and which one generated this sale." />
      {!data ? (
        <div className="px-8 text-[13px] text-ink-muted">Loading…</div>
      ) : (
        <div className="px-5 md:px-8 grid md:grid-cols-2 gap-4">
          <div className="card p-4">
            <p className="text-[13px] font-semibold text-ink-primary mb-3">Revenue by traffic source (last touch)</p>
            {data.revenueBySource.length === 0 ? (
              <p className="text-[12.5px] text-ink-muted">No attributed sales yet.</p>
            ) : (
              <div className="space-y-2">
                {data.revenueBySource
                  .sort((a, b) => b.revenue - a.revenue)
                  .map((row, i) => (
                    <Bar key={row.source} label={row.source} value={row.revenue} max={data.revenueBySource[0].revenue} color={["#2a78d6", "#eb6834", "#1baf7a", "#eda100"][i % 4]} format={fmtUGX} />
                  ))}
              </div>
            )}
          </div>
          <div className="card p-4">
            <p className="text-[13px] font-semibold text-ink-primary mb-3">Revenue by campaign (last touch)</p>
            {data.revenueByCampaign.length === 0 ? (
              <p className="text-[12.5px] text-ink-muted">No attributed sales yet.</p>
            ) : (
              <div className="space-y-2">
                {data.revenueByCampaign
                  .sort((a, b) => b.revenue - a.revenue)
                  .map((row, i) => (
                    <Bar key={row.campaign} label={row.campaign} value={row.revenue} max={data.revenueByCampaign[0].revenue} color={["#2a78d6", "#eb6834", "#1baf7a", "#eda100"][i % 4]} format={fmtUGX} />
                  ))}
              </div>
            )}
          </div>

          <div className="card overflow-hidden md:col-span-2">
            <div className="p-4 pb-2">
              <p className="text-[13px] font-semibold text-ink-primary">Assisted conversions</p>
              <p className="text-[12px] text-ink-muted mt-0.5">
                First/last touch above only credits the opening and closing interaction of a deal. This shows every source that appeared earlier in the path but didn&apos;t close it —
                the channels that helped without getting the final click.
              </p>
            </div>
            {data.assisted.length === 0 ? (
              <p className="text-[12.5px] text-ink-muted px-4 pb-4">No multi-touch conversions yet — every sale so far converted on its first interaction.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-black/10 dark:border-white/10 text-left text-ink-muted text-[11px] uppercase tracking-wide">
                      <th className="px-4 py-2 font-medium">Source</th>
                      <th className="px-4 py-2 font-medium text-right">Closed (last-click)</th>
                      <th className="px-4 py-2 font-medium text-right">Closed revenue</th>
                      <th className="px-4 py-2 font-medium text-right">Assisted conversions</th>
                      <th className="px-4 py-2 font-medium text-right">Assisted revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.assisted.map((row) => (
                      <tr key={row.source} className="border-b border-black/[0.05] dark:border-white/[0.05]">
                        <td className="px-4 py-2 text-ink-primary capitalize">{row.source}</td>
                        <td className="px-4 py-2 text-ink-secondary text-right tabular-nums">{row.closedConversions}</td>
                        <td className="px-4 py-2 text-ink-secondary text-right tabular-nums">{fmtUGX(row.closedRevenue)}</td>
                        <td className="px-4 py-2 text-ink-secondary text-right tabular-nums">{row.assistedConversions}</td>
                        <td className="px-4 py-2 text-ink-secondary text-right tabular-nums">{fmtUGX(row.assistedRevenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card overflow-hidden md:col-span-2">
            <p className="text-[13px] font-semibold text-ink-primary p-4 pb-2">Attribution touches</p>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-black/10 dark:border-white/10 text-left text-ink-muted text-[11px] uppercase tracking-wide">
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 font-medium">Campaign</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {data.touches.slice(0, 20).map((t) => (
                  <tr key={t.id} className="border-b border-black/[0.05] dark:border-white/[0.05]">
                    <td className="px-4 py-2 text-ink-primary">{t.touchType}</td>
                    <td className="px-4 py-2 text-ink-secondary">{t.source || "direct"}</td>
                    <td className="px-4 py-2 text-ink-secondary">{t.campaign || "—"}</td>
                    <td className="px-4 py-2 text-ink-muted">{new Date(t.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card p-4 md:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[13px] font-semibold text-ink-primary">Organic Google Search (last 30 days)</p>
              {organic?.connected && <Badge tone="good">{organic.propertyName}</Badge>}
            </div>
            {!organic?.connected ? (
              <p className="text-[12.5px] text-ink-muted">
                Not connected — <a href="/integrations" className="text-brand-600 hover:underline">connect Google Search (Organic)</a> on Integrations to see impressions, clicks, and top
                queries here. No ad spend involved — this is free organic traffic.
              </p>
            ) : (
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="grid grid-cols-3 gap-2 sm:col-span-1 sm:grid-cols-1">
                  <Stat label="Impressions" value={organic.totalImpressions?.toLocaleString() ?? "0"} />
                  <Stat label="Clicks" value={organic.totalClicks?.toLocaleString() ?? "0"} />
                  <Stat label="Avg. position" value={organic.avgPosition?.toFixed(1) ?? "—"} />
                </div>
                <div className="sm:col-span-2">
                  <p className="text-[11px] text-ink-muted uppercase tracking-wide mb-1.5">Top queries</p>
                  <div className="space-y-1">
                    {(organic.topQueries ?? []).map((q) => (
                      <div key={q.query} className="flex items-center justify-between text-[12.5px]">
                        <span className="text-ink-secondary truncate">{q.query}</span>
                        <span className="text-ink-muted tabular-nums shrink-0 ml-2">
                          {q.clicks} clicks · {q.impressions} impr.
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
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
      <p className="text-[16px] font-semibold text-ink-primary tabular-nums">{value}</p>
    </div>
  );
}

function Bar({ label, value, max, color, format }: { label: string; value: number; max: number; color: string; format: (n: number) => string }) {
  return (
    <div>
      <div className="flex justify-between text-[12px] text-ink-secondary mb-1">
        <span className="capitalize">{label}</span>
        <span className="tabular-nums font-medium text-ink-primary">{format(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-black/[0.05] dark:bg-white/10 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.max(4, (value / Math.max(max, 1)) * 100)}%`, background: color }} />
      </div>
    </div>
  );
}
