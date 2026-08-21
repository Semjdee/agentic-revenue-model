"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import clsx from "clsx";

interface AgentCostRow {
  agentId: string | null;
  agentName: string;
  tenantId: string;
  tenantName: string;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
  approxCredits: number;
}
interface CohortRow {
  cohortMonth: string;
  cohortSize: number;
  retention: (number | null)[];
}
interface TenantForecastRow {
  tenantId: string;
  tenantName: string;
  avgDailyCredits7d: number;
  projectedMonthlyCredits: number;
  monthlyAllotment: number;
  overAllotment: boolean;
}
interface AnalyticsData {
  topAgentsByCost: AgentCostRow[];
  cohorts: CohortRow[];
  tenantForecasts: TenantForecastRow[];
}

function fmtUsd(n: number) {
  return "$" + n.toFixed(4);
}

export default function PlatformAnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);

  useEffect(() => {
    api.get<AnalyticsData>("/api/platform/analytics").then(setData);
  }, []);

  if (!data) return <p className="text-[13px] text-white/50">Loading…</p>;

  return (
    <div className="space-y-8 max-w-6xl">
      <div>
        <h1 className="text-[18px] font-semibold text-white">Deep Analytics</h1>
        <p className="text-[12.5px] text-white/50 mt-0.5">Per-agent cost breakdown, cohort retention, and per-tenant usage forecasts — all from real usage data.</p>
      </div>

      <section>
        <h2 className="text-[14px] font-semibold text-white mb-1">Per-agent cost leaders (last 30 days)</h2>
        <p className="text-[11.5px] text-white/40 mb-3">Real cost from agent_runs, not a per-conversation estimate. Credits shown are an aggregate approximation of the summed real cost.</p>
        <div className="border border-white/10 rounded-lg overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-white/10 text-left text-white/40 text-[11px] uppercase tracking-wide">
                <th className="px-4 py-2.5 font-medium">Agent</th>
                <th className="px-4 py-2.5 font-medium">Tenant</th>
                <th className="px-4 py-2.5 font-medium text-right">Runs</th>
                <th className="px-4 py-2.5 font-medium text-right">Tokens (in/out)</th>
                <th className="px-4 py-2.5 font-medium text-right">Cost (USD)</th>
                <th className="px-4 py-2.5 font-medium text-right">~Credits</th>
              </tr>
            </thead>
            <tbody>
              {data.topAgentsByCost.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-white/40">
                    No AI runs in the last 30 days yet.
                  </td>
                </tr>
              ) : (
                data.topAgentsByCost.map((r, i) => (
                  <tr key={i} className="border-b border-white/[0.05]">
                    <td className="px-4 py-2 text-white font-medium">{r.agentName}</td>
                    <td className="px-4 py-2 text-white/60">{r.tenantName}</td>
                    <td className="px-4 py-2 text-white/60 text-right tabular-nums">{r.runs}</td>
                    <td className="px-4 py-2 text-white/60 text-right tabular-nums">
                      {r.inputTokens.toLocaleString()} / {r.outputTokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-white/80 text-right tabular-nums">{fmtUsd(r.totalCostUsd)}</td>
                    <td className="px-4 py-2 text-white/80 text-right tabular-nums">{r.approxCredits.toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-[14px] font-semibold text-white mb-1">Tenant usage forecast (7-day pace, projected monthly)</h2>
        <p className="text-[11.5px] text-white/40 mb-3">Flags tenants trending to exceed their monthly credit allotment at their current pace — a heads-up before they run out mid-month.</p>
        <div className="border border-white/10 rounded-lg overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-white/10 text-left text-white/40 text-[11px] uppercase tracking-wide">
                <th className="px-4 py-2.5 font-medium">Tenant</th>
                <th className="px-4 py-2.5 font-medium text-right">Avg credits/day</th>
                <th className="px-4 py-2.5 font-medium text-right">Projected monthly</th>
                <th className="px-4 py-2.5 font-medium text-right">Allotment</th>
                <th className="px-4 py-2.5 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.tenantForecasts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-white/40">
                    No usage in the last 7 days yet.
                  </td>
                </tr>
              ) : (
                data.tenantForecasts.map((r) => (
                  <tr key={r.tenantId} className="border-b border-white/[0.05]">
                    <td className="px-4 py-2 text-white font-medium">{r.tenantName}</td>
                    <td className="px-4 py-2 text-white/60 text-right tabular-nums">{r.avgDailyCredits7d.toLocaleString()}</td>
                    <td className="px-4 py-2 text-white/60 text-right tabular-nums">{r.projectedMonthlyCredits.toLocaleString()}</td>
                    <td className="px-4 py-2 text-white/60 text-right tabular-nums">{r.monthlyAllotment.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right">
                      <span className={clsx("px-2 py-0.5 rounded-full text-[11px] font-medium", r.overAllotment ? "bg-status-critical/20 text-red-300" : "bg-white/10 text-white/60")}>
                        {r.overAllotment ? "Over pace" : "On pace"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-[14px] font-semibold text-white mb-1">Cohort retention</h2>
        <p className="text-[11.5px] text-white/40 mb-3">% of each signup-month cohort with at least one conversation in that month-offset. — = hasn&apos;t happened yet for that cohort.</p>
        <div className="border border-white/10 rounded-lg overflow-hidden overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-white/10 text-left text-white/40 text-[11px] uppercase tracking-wide">
                <th className="px-4 py-2.5 font-medium">Cohort</th>
                <th className="px-4 py-2.5 font-medium text-right">Size</th>
                {Array.from({ length: 7 }).map((_, i) => (
                  <th key={i} className="px-3 py-2.5 font-medium text-right">
                    M{i}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.cohorts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-white/40">
                    No tenants yet.
                  </td>
                </tr>
              ) : (
                data.cohorts.map((c) => (
                  <tr key={c.cohortMonth} className="border-b border-white/[0.05]">
                    <td className="px-4 py-2 text-white font-medium">{c.cohortMonth}</td>
                    <td className="px-4 py-2 text-white/60 text-right tabular-nums">{c.cohortSize}</td>
                    {c.retention.map((v, i) => (
                      <td key={i} className="px-3 py-2 text-right tabular-nums text-white/70">
                        {v === null ? <span className="text-white/25">—</span> : `${v}%`}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
