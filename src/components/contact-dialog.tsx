"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { Dialog } from "@/components/ui/dialog";
import { Badge, stageTone } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { channelLabel } from "@/lib/channel-labels";
import { MessageCircle, Check, Pencil } from "lucide-react";

// The "client dialog" — a full contact profile, not just the lead-stage
// management view (see src/app/(app)/leads/page.tsx's LeadDialog, which
// stays focused on stage/won/lost). Shared between wherever a contact's
// name is clickable so there's one implementation, not a copy per page —
// currently the Leads Kanban (clicking a lead's name) and the Contacts
// table.

interface Contact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  tags: string[];
  createdAt: string;
}
interface Identity {
  id: string;
  type: string;
  value: string;
}
interface ConversationRow {
  id: string;
  channel: string;
  status: string;
  aiActive: boolean;
  leadScore: number;
  unread: boolean;
  lastMessageAt: string;
  utmCampaign: string | null;
}
interface LeadRow {
  id: string;
  stage: string;
  score: number;
  source: string | null;
  campaign: string | null;
}
interface OpportunityRow {
  id: string;
  stage: string;
  estimatedValue: string | null;
  actualSaleValue: string | null;
}
interface ContactDetailResponse {
  contact: Contact;
  identities: Identity[];
  conversations: ConversationRow[];
  leads: LeadRow[];
  opportunities: OpportunityRow[];
}

export function ContactDialog({ contactId, onClose, onChanged }: { contactId: string; onClose: () => void; onChanged?: () => void }) {
  const [data, setData] = useState<ContactDetailResponse | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "" });
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await api.get<ContactDetailResponse>(`/api/internal/contacts/${contactId}`);
    setData(res);
    setForm({ name: res.contact.name ?? "", email: res.contact.email ?? "", phone: res.contact.phone ?? "", company: res.contact.company ?? "" });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load on mount / contactId change only
  }, [contactId]);

  async function save() {
    setSaving(true);
    try {
      await api.patch(`/api/internal/contacts/${contactId}`, form);
      await load();
      setEditing(false);
      onChanged?.();
    } finally {
      setSaving(false);
    }
  }

  const title = data?.contact.name || data?.contact.phone || data?.contact.email || "Contact";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={title} description={data ? `Client since ${new Date(data.contact.createdAt).toLocaleDateString()}` : undefined} widthClassName="max-w-xl">
      {!data ? (
        <p className="text-[12.5px] text-ink-muted">Loading…</p>
      ) : (
        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-ink-secondary uppercase tracking-wide">Contact details</p>
              {!editing && (
                <button onClick={() => setEditing(true)} className="text-ink-muted hover:text-ink-primary">
                  <Pencil size={13} />
                </button>
              )}
            </div>
            {editing ? (
              <div className="space-y-2.5">
                <div>
                  <Label>Name</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <Label>Phone</Label>
                    <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </div>
                </div>
                <div>
                  <Label>Company</Label>
                  <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={save} disabled={saving}>
                    <Check size={13} /> {saving ? "Saving…" : "Save"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px]">
                <Row label="Phone" value={data.contact.phone} />
                <Row label="Email" value={data.contact.email} />
                <Row label="Company" value={data.contact.company} />
                <Row label="Identities" value={data.identities.map((i) => `${channelLabel(i.type)}: ${i.value}`).join(", ") || null} />
              </dl>
            )}
          </div>

          <div>
            <p className="text-[11px] font-semibold text-ink-secondary uppercase tracking-wide mb-2">
              Conversations ({data.conversations.length})
            </p>
            {data.conversations.length === 0 && <p className="text-[12.5px] text-ink-muted">No conversations yet.</p>}
            <div className="space-y-1.5">
              {data.conversations.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-lg border border-black/[0.06] dark:border-white/[0.08] px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <MessageCircle size={13} className="text-ink-muted shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[12.5px] text-ink-primary truncate">
                        {channelLabel(c.channel)}
                        {c.utmCampaign ? ` · ${c.utmCampaign}` : ""}
                      </p>
                      <p className="text-[11px] text-ink-muted">{new Date(c.lastMessageAt).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {c.unread && <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />}
                    <Badge tone={c.aiActive ? "brand" : "warning"}>{c.aiActive ? "AI" : "Human"}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold text-ink-secondary uppercase tracking-wide mb-2">Leads ({data.leads.length})</p>
            {data.leads.length === 0 && <p className="text-[12.5px] text-ink-muted">No leads yet.</p>}
            <div className="space-y-1.5">
              {data.leads.map((l) => (
                <div key={l.id} className="flex items-center justify-between rounded-lg border border-black/[0.06] dark:border-white/[0.08] px-3 py-2 text-[12.5px]">
                  <span className="text-ink-secondary">{channelLabel(l.source)}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-ink-muted">{l.score} pts</span>
                    <Badge tone={stageTone(l.stage)}>{l.stage}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {data.opportunities.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-ink-secondary uppercase tracking-wide mb-2">Opportunities ({data.opportunities.length})</p>
              <div className="space-y-1.5">
                {data.opportunities.map((o) => (
                  <div key={o.id} className="flex items-center justify-between rounded-lg border border-black/[0.06] dark:border-white/[0.08] px-3 py-2 text-[12.5px]">
                    <span className="text-ink-secondary">
                      {o.actualSaleValue ? `UGX ${Number(o.actualSaleValue).toLocaleString()}` : o.estimatedValue ? `~UGX ${Number(o.estimatedValue).toLocaleString()}` : "—"}
                    </span>
                    <Badge tone={stageTone(o.stage)}>{o.stage}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-ink-primary truncate">{value || "—"}</dd>
    </>
  );
}
