"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api-client";

interface Intelligence {
  totalCustomerMessages: number;
  objectionBreakdown: { category: string; count: number; pct: number }[];
  topRequestedProducts: { product: string; count: number }[];
  lostSaleReasons: { reason: string; count: number }[];
}

const COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7"];

export default function ReportsPage() {
  const [intel, setIntel] = useState<Intelligence | null>(null);

  useEffect(() => {
    api.get<{ intelligence: Intelligence }>("/api/internal/advertising/performance").then((r) => setIntel(r.intelligence));
  }, []);

  return (
    <div className="pb-12">
      <PageHeader title="Reports" description="Conversation Intelligence — what customers are actually asking, objecting to, and losing on." />
      {!intel ? (
        <div className="px-8 text-[13px] text-ink-muted">Loading…</div>
      ) : (
        <div className="px-5 md:px-8 grid md:grid-cols-2 gap-4">
          <div className="card p-4">
            <p className="text-[13px] font-semibold text-ink-primary mb-3">Customer Objections — last 30 days</p>
            <div className="space-y-2">
              {intel.objectionBreakdown.map((o, i) => (
                <div key={o.category}>
                  <div className="flex justify-between text-[12px] text-ink-secondary mb-1">
                    <span className="capitalize">{o.category}</span>
                    <span className="tabular-nums font-medium text-ink-primary">{o.pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-black/[0.05] dark:bg-white/10 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(2, o.pct)}%`, background: COLORS[i % COLORS.length] }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11.5px] text-ink-muted mt-3">Based on {intel.totalCustomerMessages} customer messages.</p>
          </div>

          <div className="card p-4">
            <p className="text-[13px] font-semibold text-ink-primary mb-3">Top Requested Products</p>
            {intel.topRequestedProducts.length === 0 ? (
              <p className="text-[12.5px] text-ink-muted">No product interest recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {intel.topRequestedProducts.map((p) => (
                  <div key={p.product} className="flex items-center justify-between text-[12.5px]">
                    <span className="text-ink-primary">{p.product}</span>
                    <span className="text-ink-muted tabular-nums">{p.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card p-4 md:col-span-2">
            <p className="text-[13px] font-semibold text-ink-primary mb-3">Lost-Sale Reasons</p>
            {intel.lostSaleReasons.length === 0 ? (
              <p className="text-[12.5px] text-ink-muted">No lost opportunities recorded yet.</p>
            ) : (
              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
                {intel.lostSaleReasons.map((r) => (
                  <div key={r.reason} className="flex items-center justify-between rounded-lg bg-black/[0.02] dark:bg-white/[0.03] px-3 py-2">
                    <span className="text-[12.5px] text-ink-primary">{r.reason}</span>
                    <span className="text-[12.5px] text-ink-muted tabular-nums">{r.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
