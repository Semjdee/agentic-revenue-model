"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Sparkles, Plus, Copy, Check } from "lucide-react";

interface Metrics {
  clicks: number;
  conversationsStarted: number;
  clickToConversationRate: number;
  leads: number;
  qualifiedLeads: number;
  opportunities: number;
  sales: number;
  revenue: number;
  aov: number;
  leadToSaleRate: number;
  cost: number;
  cpl: number;
  costPerQualifiedLead: number;
  costPerSale: number;
  roas: number;
  roi: number;
}
interface Influencer {
  id: string;
  name: string;
  handle: string | null;
  platform: string;
  category: string | null;
  status: string;
  metrics?: Metrics;
  commercialScore: number | null;
  publicityScore: number | null;
  classification: string;
}
interface TrackingLink {
  id: string;
  code: string;
  url: string;
  campaignName: string;
  contentLabel: string | null;
  destinationType: string;
  destinationValue: string;
  status: string;
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
}
interface InfluencerDetail {
  influencer: Influencer;
  metrics: Metrics;
  commercialScore: number | null;
  publicityScore: number | null;
  classification: string;
  trackingLinks: TrackingLink[];
  costs: { id: string; amount: string; currency: string; note: string | null; incurredAt: string }[];
  recommendations: Recommendation[];
}

const CLASSIFICATION_LABELS: Record<string, string> = {
  SALES_DRIVER: "Sales Driver",
  PUBLICITY_DRIVER: "Publicity Driver",
  FULL_FUNNEL_PERFORMER: "Full-Funnel Performer",
  ENGAGEMENT_SPECIALIST: "Engagement Specialist",
  EMERGING_PERFORMER: "Emerging Performer",
  UNDERPERFORMER: "Underperformer",
  INSUFFICIENT_DATA: "Insufficient Data",
};
const CLASSIFICATION_TONE: Record<string, "good" | "warning" | "critical" | "neutral"> = {
  SALES_DRIVER: "good",
  FULL_FUNNEL_PERFORMER: "good",
  PUBLICITY_DRIVER: "neutral",
  ENGAGEMENT_SPECIALIST: "neutral",
  EMERGING_PERFORMER: "warning",
  UNDERPERFORMER: "critical",
  INSUFFICIENT_DATA: "neutral",
};

function fmtUGX(n: number) {
  return "UGX " + Math.round(n).toLocaleString();
}

export default function InfluencersPage() {
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  async function load() {
    setLoading(true);
    setInfluencers(await api.get<Influencer[]>("/api/internal/influencers"));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function runAnalyst() {
    setAnalyzing(true);
    await api.post("/api/internal/influencers/recommendations/run");
    setAnalyzing(false);
    if (detailId) setDetailId(detailId); // re-trigger detail refresh via effect below
  }

  return (
    <div className="pb-12">
      <PageHeader
        title="Influencers"
        description="Track creator partnerships end-to-end — referral clicks, conversations, leads, sales, and real revenue. Scores are computed from your own data, never invented."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={runAnalyst} disabled={analyzing}>
              <Sparkles size={15} /> {analyzing ? "Analyzing…" : "Run AI Influencer Analyst"}
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <Plus size={15} /> Add Influencer
            </Button>
          </div>
        }
      />

      <div className="px-5 md:px-8">
        {loading ? (
          <p className="text-[13px] text-ink-muted">Loading…</p>
        ) : influencers.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-[13px] text-ink-primary font-medium">No influencers yet</p>
            <p className="text-[12.5px] text-ink-muted mt-1">Add a creator and generate a tracking link to start measuring their real impact on leads and sales.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {influencers.map((inf) => (
              <button key={inf.id} onClick={() => setDetailId(inf.id)} className="card p-4 text-left hover:border-black/20 dark:hover:border-white/25 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[13.5px] font-semibold text-ink-primary">{inf.name}</p>
                    <p className="text-[11.5px] text-ink-muted">
                      {inf.handle ? `@${inf.handle}` : "—"} · {inf.platform.charAt(0) + inf.platform.slice(1).toLowerCase()}
                    </p>
                  </div>
                  <Badge tone={CLASSIFICATION_TONE[inf.classification] ?? "neutral"}>{CLASSIFICATION_LABELS[inf.classification] ?? inf.classification}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                  <MiniStat label="Leads" value={String(inf.metrics?.leads ?? 0)} />
                  <MiniStat label="Sales" value={String(inf.metrics?.sales ?? 0)} />
                  <MiniStat label="Revenue" value={fmtUGX(inf.metrics?.revenue ?? 0)} />
                </div>
                <div className="mt-3 space-y-1.5">
                  <ScoreBar label="Commercial" value={inf.commercialScore} />
                  <ScoreBar label="Publicity" value={inf.publicityScore} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <AddInfluencerDialog open={addOpen} onOpenChange={setAddOpen} onCreated={load} />
      {detailId && <InfluencerDetailDialog influencerId={detailId} onClose={() => { setDetailId(null); load(); }} />}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[13px] font-semibold text-ink-primary tabular-nums">{value}</p>
      <p className="text-[10px] text-ink-muted uppercase tracking-wide">{label}</p>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="flex justify-between text-[10.5px] text-ink-muted mb-0.5">
        <span>{label}</span>
        <span className="tabular-nums">{value === null ? "—" : value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-black/[0.06] dark:bg-white/10 overflow-hidden">
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${value ?? 0}%` }} />
      </div>
    </div>
  );
}

function AddInfluencerDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [platform, setPlatform] = useState("INSTAGRAM");
  const [category, setCategory] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setHandle("");
      setPlatform("INSTAGRAM");
      setCategory("");
      setError(null);
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/api/internal/influencers", { name, handle: handle || undefined, platform, category: category || undefined });
      onCreated();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add Influencer" description="Add a creator to start generating tracking links and measuring their real impact.">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label>Name</Label>
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Amina K." />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Handle</Label>
            <Input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="aminak" />
          </div>
          <div>
            <Label>Platform</Label>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="w-full rounded-lg border border-black/10 dark:border-white/15 bg-surface px-3 py-2 text-[13.5px] text-ink-primary">
              {["INSTAGRAM", "TIKTOK", "YOUTUBE", "FACEBOOK", "OTHER"].map((p) => (
                <option key={p} value={p}>
                  {p.charAt(0) + p.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <Label>Category</Label>
          <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Home & lifestyle" />
        </div>
        {error && <p className="text-[12.5px] text-status-critical">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Add Influencer"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function InfluencerDetailDialog({ influencerId, onClose }: { influencerId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<InfluencerDetail | null>(null);
  const [linkFormOpen, setLinkFormOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function load() {
    setDetail(await api.get<InfluencerDetail>(`/api/internal/influencers/${influencerId}`));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [influencerId]);

  async function decide(id: string, decision: "APPROVED" | "REJECTED") {
    await api.patch(`/api/internal/influencers/recommendations/${id}`, { decision });
    load();
  }

  async function copyUrl(link: TrackingLink) {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopiedId(link.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // clipboard API unavailable — non-fatal, link is still shown as text
    }
  }

  if (!detail) {
    return (
      <Dialog open onOpenChange={onClose} title="Loading…" widthClassName="max-w-2xl">
        <p className="text-[13px] text-ink-muted">Loading…</p>
      </Dialog>
    );
  }

  const m = detail.metrics;
  const pending = detail.recommendations.filter((r) => r.status === "NEW");
  const decided = detail.recommendations.filter((r) => r.status !== "NEW");

  return (
    <Dialog open onOpenChange={onClose} title={detail.influencer.name} description={`${detail.influencer.handle ? "@" + detail.influencer.handle : ""} · ${detail.influencer.platform}`} widthClassName="max-w-2xl">
      <div className="space-y-5">
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
          <Stat label="Clicks" value={m.clicks.toLocaleString()} />
          <Stat label="Conversations" value={m.conversationsStarted.toLocaleString()} />
          <Stat label="Leads" value={m.leads.toLocaleString()} />
          <Stat label="Sales" value={m.sales.toLocaleString()} />
          <Stat label="Revenue" value={fmtUGX(m.revenue)} />
          <Stat label="Cost" value={fmtUGX(m.cost)} />
          <Stat label="ROAS" value={`${m.roas.toFixed(1)}x`} />
          <Stat label="Cost / Sale" value={m.sales > 0 ? fmtUGX(m.costPerSale) : "—"} />
          <Stat label="AOV" value={m.sales > 0 ? fmtUGX(m.aov) : "—"} />
          <Stat label="Qualified Leads" value={m.qualifiedLeads.toLocaleString()} />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[13px] font-semibold text-ink-primary">Tracking links</p>
            <Button size="sm" variant="secondary" onClick={() => setLinkFormOpen((v) => !v)}>
              <Plus size={13} /> New link
            </Button>
          </div>
          {linkFormOpen && <NewTrackingLinkForm influencerId={influencerId} onCreated={() => { setLinkFormOpen(false); load(); }} />}
          {detail.trackingLinks.length === 0 ? (
            <p className="text-[12.5px] text-ink-muted">No tracking links yet — create one to start measuring this creator&apos;s traffic.</p>
          ) : (
            <div className="space-y-1.5">
              {detail.trackingLinks.map((l) => (
                <div key={l.id} className="flex items-center justify-between text-[12.5px] border border-black/10 dark:border-white/10 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-ink-primary font-medium truncate">
                      {l.campaignName}
                      {l.contentLabel ? ` · ${l.contentLabel}` : ""}
                    </p>
                    <p className="text-ink-muted truncate font-mono text-[11.5px]">{l.url}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => copyUrl(l)}>
                    {copiedId === l.id ? <Check size={13} /> : <Copy size={13} />}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <AddCostForm influencerId={influencerId} onCreated={load} totalCost={m.cost} />

        {pending.length > 0 && (
          <div>
            <p className="text-[13px] font-semibold text-ink-primary mb-2">AI recommendations</p>
            <div className="space-y-2">
              {pending.map((r) => (
                <div key={r.id} className="border border-black/10 dark:border-white/10 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[12.5px] font-semibold text-ink-primary">{r.title}</p>
                    <Badge tone={r.risk === "LOW" ? "neutral" : r.risk === "MEDIUM" ? "warning" : "critical"}>{r.confidence} confidence</Badge>
                  </div>
                  {r.finding && <p className="text-[12px] text-ink-secondary mt-1">{r.finding}</p>}
                  {r.evidence && <p className="text-[11.5px] text-ink-muted mt-0.5">{r.evidence}</p>}
                  <p className="text-[12px] text-ink-primary mt-1.5">{r.recommendation}</p>
                  <div className="flex gap-2 mt-2">
                    <Button size="sm" onClick={() => decide(r.id, "APPROVED")}>
                      Approve
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => decide(r.id, "REJECTED")}>
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {decided.length > 0 && (
          <div>
            <p className="text-[11px] text-ink-muted uppercase tracking-wide mb-1.5">Past decisions</p>
            <div className="space-y-1">
              {decided.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-[12px]">
                  <span className="text-ink-secondary">{r.title}</span>
                  <Badge tone={r.status === "APPROVED" ? "good" : "neutral"}>{r.status}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10.5px] text-ink-muted uppercase tracking-wide">{label}</p>
      <p className="text-[14px] font-semibold text-ink-primary tabular-nums">{value}</p>
    </div>
  );
}

function NewTrackingLinkForm({ influencerId, onCreated }: { influencerId: string; onCreated: () => void }) {
  const [campaignName, setCampaignName] = useState("");
  const [contentLabel, setContentLabel] = useState("");
  const [destinationType, setDestinationType] = useState<"WHATSAPP" | "WEBSITE">("WHATSAPP");
  const [destinationValue, setDestinationValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/api/internal/influencers/${influencerId}/tracking-links`, { campaignName, contentLabel: contentLabel || undefined, destinationType, destinationValue });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create link");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="border border-black/10 dark:border-white/10 rounded-lg p-3 mb-2 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Campaign</Label>
          <Input required value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="e.g. Ramadan Launch" />
        </div>
        <div>
          <Label>Content label</Label>
          <Input value={contentLabel} onChange={(e) => setContentLabel(e.target.value)} placeholder="e.g. Reel #3" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Destination</Label>
          <select value={destinationType} onChange={(e) => setDestinationType(e.target.value as "WHATSAPP" | "WEBSITE")} className="w-full rounded-lg border border-black/10 dark:border-white/15 bg-surface px-3 py-2 text-[13.5px] text-ink-primary">
            <option value="WHATSAPP">WhatsApp</option>
            <option value="WEBSITE">Website</option>
          </select>
        </div>
        <div>
          <Label>{destinationType === "WHATSAPP" ? "WhatsApp number" : "URL"}</Label>
          <Input required value={destinationValue} onChange={(e) => setDestinationValue(e.target.value)} placeholder={destinationType === "WHATSAPP" ? "+256700000000" : "https://…"} />
        </div>
      </div>
      {error && <p className="text-[12px] text-status-critical">{error}</p>}
      <Button size="sm" type="submit" disabled={submitting}>
        {submitting ? "Creating…" : "Create link"}
      </Button>
    </form>
  );
}

function AddCostForm({ influencerId, onCreated, totalCost }: { influencerId: string; onCreated: () => void; totalCost: number }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/api/internal/influencers/${influencerId}/costs`, { amount: Number(amount), note: note || undefined });
      setAmount("");
      setNote("");
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record cost");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[13px] font-semibold text-ink-primary">Costs</p>
        <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
          <Plus size={13} /> Record payment
        </Button>
      </div>
      {open && (
        <form onSubmit={submit} className="border border-black/10 dark:border-white/10 rounded-lg p-3 mb-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Amount (UGX)</Label>
              <Input required type="number" min="0" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <Label>Note</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Content fee" />
            </div>
          </div>
          {error && <p className="text-[12px] text-status-critical">{error}</p>}
          <Button size="sm" type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </form>
      )}
      <p className="text-[12px] text-ink-muted">Total recorded: {fmtUGX(totalCost)}</p>
    </div>
  );
}
