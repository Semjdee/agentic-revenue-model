"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api-client";

interface AttributionData {
  revenueBySource: { source: string; revenue: number }[];
  revenueByCampaign: { campaign: string; revenue: number }[];
  touches: { id: string; touchType: string; source: string | null; campaign: string | null; createdAt: string }[];
}

function fmtUGX(n: number) {
  return "UGX " + Math.round(n).toLocaleString();
}

export default function AttributionPage() {
  const [data, setData] = useState<AttributionData | null>(null);

  useEffect(() => {
    api.get<AttributionData>("/api/internal/attribution").then(setData);
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
        </div>
      )}
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
