"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Check, X } from "lucide-react";

interface CampaignPerformance {
  campaignId: string;
  campaignName: string;
  spend: number;
  revenue: number;
  leads: number;
  qualifiedLeads: number;
  sales: number;
  roas: number;
  cpa: number;
  cpl: number;
  ctr: number;
}
interface Recommendation {
  id: string;
  title: string;
  finding: string | null;
  evidence: string | null;
  recommendation: string;
  confidence: string;
  risk: string;
  status: string;
  campaignId: string | null;
  createdAt: string;
}

function fmtUGX(n: number) {
  return "UGX " + Math.round(n).toLocaleString();
}

export default function AdvertisingPage() {
  const [performance, setPerformance] = useState<CampaignPerformance[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [generating, setGenerating] = useState(false);

  async function load() {
    const perf = await api.get<{ performance: CampaignPerformance[] }>("/api/internal/advertising/performance");
    setPerformance(perf.performance);
    setRecommendations(await api.get<Recommendation[]>("/api/internal/advertising/recommendations"));
  }

  useEffect(() => {
    load();
  }, []);

  async function generate() {
    setGenerating(true);
    await api.post("/api/internal/advertising/recommendations");
    await load();
    setGenerating(false);
  }

  async function decide(id: string, decision: "APPROVED" | "REJECTED") {
    await api.patch(`/api/internal/advertising/recommendations/${id}`, { decision });
    load();
  }

  const pending = recommendations.filter((r) => r.status === "NEW");
  const decided = recommendations.filter((r) => r.status !== "NEW");

  return (
    <div className="pb-12">
      <PageHeader
        title="Advertising"
        description="Combines ad-platform metrics with your CRM/sales data — never ad-platform conversions alone."
        actions={
          <Button onClick={generate} disabled={generating}>
            <Sparkles size={15} /> {generating ? "Analyzing…" : "Run AI Advertising Analyst"}
          </Button>
        }
      />

      <div className="px-5 md:px-8 space-y-6">
        <div className="card overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-black/10 dark:border-white/10 text-left text-ink-muted text-[11px] uppercase tracking-wide">
                <th className="px-4 py-2.5 font-medium">Campaign</th>
                <th className="px-4 py-2.5 font-medium">Spend</th>
                <th className="px-4 py-2.5 font-medium">Leads</th>
                <th className="px-4 py-2.5 font-medium">Qualified</th>
                <th className="px-4 py-2.5 font-medium">Sales</th>
                <th className="px-4 py-2.5 font-medium">Revenue</th>
                <th className="px-4 py-2.5 font-medium">CPL</th>
                <th className="px-4 py-2.5 font-medium">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {performance.map((p) => (
                <tr key={p.campaignId} className="border-b border-black/[0.05] dark:border-white/[0.05]">
                  <td className="px-4 py-2.5 text-ink-primary font-medium">{p.campaignName}</td>
                  <td className="px-4 py-2.5 text-ink-secondary tabular-nums">{fmtUGX(p.spend)}</td>
                  <td className="px-4 py-2.5 text-ink-secondary tabular-nums">{p.leads}</td>
                  <td className="px-4 py-2.5 text-ink-secondary tabular-nums">{p.qualifiedLeads}</td>
                  <td className="px-4 py-2.5 text-ink-secondary tabular-nums">{p.sales}</td>
                  <td className="px-4 py-2.5 text-ink-secondary tabular-nums">{fmtUGX(p.revenue)}</td>
                  <td className="px-4 py-2.5 text-ink-secondary tabular-nums">{fmtUGX(p.cpl)}</td>
                  <td className="px-4 py-2.5 tabular-nums">
                    <Badge tone={p.roas >= 3 ? "good" : p.roas > 0 && p.roas < 1.5 ? "critical" : "neutral"}>{p.roas.toFixed(1)}x</Badge>
                  </td>
                </tr>
              ))}
              {performance.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-ink-muted">
                    No campaign data yet — connect Google/Meta Ads or seed demo data.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div>
          <p className="text-[13px] font-semibold text-ink-primary mb-2">AI Recommendations — awaiting your approval</p>
          <div className="space-y-2">
            {pending.length === 0 && <p className="text-[12.5px] text-ink-muted">No pending recommendations. Run the AI Advertising Analyst above.</p>}
            {pending.map((r) => (
              <div key={r.id} className="card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-[13.5px] font-semibold text-ink-primary">{r.title}</p>
                      <Badge tone="neutral">{r.confidence} confidence</Badge>
                      <Badge tone={r.risk === "LOW" ? "good" : r.risk === "MEDIUM" ? "warning" : "critical"}>{r.risk} risk</Badge>
                    </div>
                    <p className="text-[12.5px] text-ink-secondary mt-1">{r.finding}</p>
                    <p className="text-[12px] text-ink-muted mt-1">{r.evidence}</p>
                    <p className="text-[12.5px] text-ink-primary mt-2 font-medium">→ {r.recommendation}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button size="sm" onClick={() => decide(r.id, "APPROVED")}>
                      <Check size={13} /> Approve
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => decide(r.id, "REJECTED")}>
                      <X size={13} /> Reject
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {decided.length > 0 && (
          <div>
            <p className="text-[13px] font-semibold text-ink-primary mb-2">Decision history</p>
            <div className="card divide-y divide-black/[0.05] dark:divide-white/[0.05]">
              {decided.map((r) => (
                <div key={r.id} className="flex items-center justify-between px-4 py-2.5">
                  <p className="text-[12.5px] text-ink-primary">{r.title}</p>
                  <Badge tone={r.status === "IMPLEMENTED" ? "good" : r.status === "REJECTED" ? "critical" : "neutral"}>{r.status}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
