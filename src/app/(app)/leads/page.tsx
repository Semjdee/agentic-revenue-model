"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api-client";
import { Badge, stageTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { LEAD_STAGES } from "@/db/schema";

interface Lead {
  id: string;
  contactId: string;
  stage: (typeof LEAD_STAGES)[number];
  score: number;
  source: string | null;
  productsDiscussed: string[];
  createdAt: string;
}
interface Opportunity {
  id: string;
  leadId: string | null;
  estimatedValue: string | null;
  actualSaleValue: string | null;
  stage: string;
}
interface ContactDetail {
  contact: { id: string; name: string | null; phone: string | null; email: string | null };
  opportunities: Opportunity[];
}

const STAGES = LEAD_STAGES;

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [contactNames, setContactNames] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Lead | null>(null);

  async function load() {
    const rows = await api.get<Lead[]>("/api/internal/leads");
    setLeads(rows);
    const contacts = await api.get<{ id: string; name: string | null; phone: string | null; email: string | null }[]>("/api/internal/contacts");
    const map: Record<string, string> = {};
    for (const c of contacts) map[c.id] = c.name || c.phone || c.email || "Anonymous";
    setContactNames(map);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="pb-12">
      <PageHeader title="Leads" description="Every lead your AI Sales Agent has qualified, across every stage." />
      <div className="px-5 md:px-8 overflow-x-auto">
        <div className="flex gap-3 min-w-[900px]">
          {STAGES.map((stage) => {
            const stageLeads = leads.filter((l) => l.stage === stage);
            return (
              <div key={stage} className="flex-1 min-w-[150px]">
                <div className="flex items-center justify-between mb-2 px-1">
                  <p className="text-[11.5px] font-semibold text-ink-secondary uppercase tracking-wide">{stage}</p>
                  <span className="text-[11px] text-ink-muted tabular-nums">{stageLeads.length}</span>
                </div>
                <div className="space-y-2">
                  {stageLeads.map((lead) => (
                    <button key={lead.id} onClick={() => setSelected(lead)} className="w-full text-left card p-3 hover:border-brand-300">
                      <p className="text-[12.5px] font-medium text-ink-primary truncate">{contactNames[lead.contactId] || "Contact"}</p>
                      <p className="text-[11px] text-ink-muted mt-0.5 truncate">{lead.productsDiscussed?.[0] || lead.source || "—"}</p>
                      <div className="flex items-center justify-between mt-2">
                        <Badge tone={stageTone(lead.stage)}>{lead.score} pts</Badge>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selected && <LeadDialog lead={selected} contactName={contactNames[selected.contactId]} onClose={() => setSelected(null)} onChanged={load} />}
    </div>
  );
}

function LeadDialog({ lead, contactName, onClose, onChanged }: { lead: Lead; contactName: string; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<ContactDetail | null>(null);
  const [saleAmount, setSaleAmount] = useState("");
  const [lostReason, setLostReason] = useState("");

  useEffect(() => {
    api.get<ContactDetail>(`/api/internal/contacts/${lead.contactId}`).then(setDetail);
  }, [lead.contactId]);

  const opportunity = detail?.opportunities.find((o) => o.leadId === lead.id) ?? detail?.opportunities[0];

  async function markWon() {
    if (!opportunity) return;
    await api.patch(`/api/internal/opportunities/${opportunity.id}`, { stage: "WON", actualSaleValue: saleAmount || opportunity.estimatedValue || "0" });
    onChanged();
    onClose();
  }
  async function markLost() {
    if (!opportunity) return;
    await api.patch(`/api/internal/opportunities/${opportunity.id}`, { stage: "LOST", lostReason: lostReason || "Unspecified" });
    onChanged();
    onClose();
  }
  async function changeStage(stage: string) {
    await api.patch(`/api/internal/leads/${lead.id}`, { stage });
    onChanged();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={contactName || "Lead"} description={`Stage: ${lead.stage} · Score: ${lead.score}`}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {STAGES.filter((s) => s !== "WON" && s !== "LOST").map((s) => (
            <Button key={s} size="sm" variant={s === lead.stage ? "primary" : "secondary"} onClick={() => changeStage(s)}>
              {s}
            </Button>
          ))}
        </div>

        {opportunity ? (
          <div className="card p-3 bg-black/[0.02] dark:bg-white/[0.03] space-y-3">
            <p className="text-[12.5px] text-ink-secondary">
              Linked opportunity · estimated value {opportunity.estimatedValue ? `UGX ${Number(opportunity.estimatedValue).toLocaleString()}` : "—"}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Mark Won — sale amount</Label>
                <Input value={saleAmount} onChange={(e) => setSaleAmount(e.target.value)} placeholder={opportunity.estimatedValue ?? "0"} />
                <Button size="sm" className="mt-2 w-full" onClick={markWon}>
                  Mark Won
                </Button>
              </div>
              <div>
                <Label>Mark Lost — reason</Label>
                <Input value={lostReason} onChange={(e) => setLostReason(e.target.value)} placeholder="e.g. price" />
                <Button size="sm" variant="danger" className="mt-2 w-full" onClick={markLost}>
                  Mark Lost
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-[12.5px] text-ink-muted">No opportunity has been created for this lead yet.</p>
        )}
      </div>
    </Dialog>
  );
}
