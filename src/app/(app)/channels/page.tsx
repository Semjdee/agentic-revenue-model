"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Copy, Check, Settings2 } from "lucide-react";

// Channels — the Channel-layer half of the multi-agent-routing spec.
// Website Widgets are managed here; WhatsApp/Instagram/Messenger stay on
// /integrations for connect/disconnect (that page owns OAuth-shaped
// connection state) — this page only covers the routing config a Widget
// adds on top.

interface Widget {
  id: string;
  publicWidgetId: string;
  name: string;
  routingMode: "SINGLE_AGENT" | "INTENT_ROUTING" | "RULE_BASED" | "MENU_SELECTION" | "HYBRID";
  defaultAgentId: string | null;
  fallbackAgentId: string | null;
  status: "ACTIVE" | "PAUSED";
}
interface AgentSummary {
  id: string;
  name: string;
  status: string;
}

const ROUTING_MODE_LABELS: Record<Widget["routingMode"], string> = {
  SINGLE_AGENT: "Single agent",
  INTENT_ROUTING: "Intent routing",
  RULE_BASED: "Rule-based",
  MENU_SELECTION: "Menu selection",
  HYBRID: "Hybrid",
};

export default function ChannelsPage() {
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openWidgetId, setOpenWidgetId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    const [w, a] = await Promise.all([api.get<Widget[]>("/api/internal/widgets"), api.get<AgentSummary[]>("/api/internal/agents")]);
    setWidgets(w);
    setAgents(a);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function createWidget() {
    if (agents.length === 0) return;
    setCreating(true);
    try {
      const widget = await api.post<Widget>("/api/internal/widgets", { name: `${agents[0].name} Widget ${widgets.length + 1}`, defaultAgentId: agents[0].id });
      await load();
      setOpenWidgetId(widget.id);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="pb-12">
      <PageHeader
        title="Channels"
        description="Where your customers reach you, and which AI agent(s) answer."
        actions={
          <Button onClick={createWidget} disabled={creating || agents.length === 0}>
            <Plus size={15} /> New Widget
          </Button>
        }
      />
      <div className="px-5 md:px-8 space-y-6">
        <div>
          <p className="text-[12.5px] text-ink-secondary mb-2">Website Widgets</p>
          {loading ? (
            <p className="text-[12.5px] text-ink-muted">Loading…</p>
          ) : widgets.length === 0 ? (
            <p className="text-[12.5px] text-ink-muted">No widgets yet — create an agent first, then a widget to embed on your site.</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {widgets.map((w) => (
                <button key={w.id} onClick={() => setOpenWidgetId(w.id)} className="card p-4 text-left hover:border-brand-300">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[13.5px] font-medium text-ink-primary">{w.name}</p>
                    <Badge tone={w.status === "ACTIVE" ? "good" : "neutral"}>{w.status}</Badge>
                  </div>
                  <p className="text-[12px] text-ink-muted mb-2">{agents.find((a) => a.id === w.defaultAgentId)?.name ?? "No default agent"}</p>
                  <Badge tone={w.routingMode === "SINGLE_AGENT" ? "neutral" : "brand"}>{ROUTING_MODE_LABELS[w.routingMode]}</Badge>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-black/[0.06] dark:border-white/[0.08] p-4 max-w-xl">
          <p className="text-[12.5px] font-medium text-ink-primary mb-1">WhatsApp / Instagram / Messenger</p>
          <p className="text-[12px] text-ink-muted">
            Connection status lives on <a href="/integrations" className="text-brand-600 hover:underline">Integrations</a>. Multi-agent routing for
            these channels is not built yet — they currently route to the tenant&apos;s first active agent.
          </p>
        </div>
      </div>

      {openWidgetId && <WidgetDialog widgetId={openWidgetId} onClose={() => setOpenWidgetId(null)} onChanged={load} />}
    </div>
  );
}

interface WidgetAgentLink {
  id: string;
  agentId: string;
  enabled: boolean;
  priority: number;
  routingRole: string | null;
  routingDescription: string | null;
}
interface WidgetDetailResponse {
  widget: Widget;
  agentLinks: WidgetAgentLink[];
  agents: AgentSummary[];
}

function WidgetDialog({ widgetId, onClose, onChanged }: { widgetId: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<WidgetDetailResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [addAgentId, setAddAgentId] = useState("");

  async function load() {
    setData(await api.get<WidgetDetailResponse>(`/api/internal/widgets/${widgetId}`));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load on mount / id change only
  }, [widgetId]);

  async function patchWidget(patch: Partial<Widget>) {
    await api.patch(`/api/internal/widgets/${widgetId}`, patch);
    await load();
    onChanged();
  }

  async function addAgent() {
    if (!addAgentId) return;
    await api.post(`/api/internal/widgets/${widgetId}/agents`, { agentId: addAgentId, enabled: true, priority: 0 });
    setAddAgentId("");
    await load();
  }
  async function updateLink(agentId: string, patch: Partial<WidgetAgentLink>) {
    await api.post(`/api/internal/widgets/${widgetId}/agents`, { agentId, ...patch });
    await load();
  }
  async function removeLink(agentId: string) {
    await api.del(`/api/internal/widgets/${widgetId}/agents/${agentId}`);
    await load();
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const snippet = data ? `<script\n  src="${origin}/widget.js"\n  data-widget="${data.widget.publicWidgetId}"\n  async>\n</script>` : "";

  function copySnippet() {
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const unlinkedAgents = data ? data.agents.filter((a) => !data.agentLinks.some((l) => l.agentId === a.id)) : [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={data?.widget.name ?? "Widget"} description="Website widget routing configuration" widthClassName="max-w-2xl">
      {!data ? (
        <p className="text-[12.5px] text-ink-muted">Loading…</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Name</Label>
              <Input defaultValue={data.widget.name} onBlur={(e) => e.target.value !== data.widget.name && patchWidget({ name: e.target.value })} />
            </div>
            <div>
              <Label>Routing mode</Label>
              <select
                value={data.widget.routingMode}
                onChange={(e) => patchWidget({ routingMode: e.target.value as Widget["routingMode"] })}
                className="w-full rounded-md border border-black/10 dark:border-white/15 bg-surface px-2.5 py-[7px] text-[13px]"
              >
                {Object.entries(ROUTING_MODE_LABELS).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Default agent</Label>
              <select
                value={data.widget.defaultAgentId ?? ""}
                onChange={(e) => patchWidget({ defaultAgentId: e.target.value || null })}
                className="w-full rounded-md border border-black/10 dark:border-white/15 bg-surface px-2.5 py-[7px] text-[13px]"
              >
                <option value="">—</option>
                {data.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Fallback agent (if routing can&apos;t decide)</Label>
              <select
                value={data.widget.fallbackAgentId ?? ""}
                onChange={(e) => patchWidget({ fallbackAgentId: e.target.value || null })}
                className="w-full rounded-md border border-black/10 dark:border-white/15 bg-surface px-2.5 py-[7px] text-[13px]"
              >
                <option value="">— use default agent —</option>
                {data.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {data.widget.routingMode !== "SINGLE_AGENT" && (
            <div>
              <p className="text-[11px] font-semibold text-ink-secondary uppercase tracking-wide mb-2">Eligible agents &amp; routing rules</p>
              <div className="space-y-2">
                {data.agentLinks.map((link) => {
                  const agent = data.agents.find((a) => a.id === link.agentId);
                  return (
                    <div key={link.id} className="rounded-lg border border-black/[0.06] dark:border-white/[0.08] p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[13px] font-medium text-ink-primary">{agent?.name ?? link.agentId}</p>
                        <div className="flex items-center gap-2">
                          <button onClick={() => updateLink(link.agentId, { enabled: !link.enabled })} className="text-[11px]">
                            <Badge tone={link.enabled ? "good" : "neutral"}>{link.enabled ? "Enabled" : "Disabled"}</Badge>
                          </button>
                          <button onClick={() => removeLink(link.agentId)} className="text-status-critical text-[11.5px] hover:underline">
                            Remove
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          placeholder="Role (e.g. SALES, SUPPORT)"
                          defaultValue={link.routingRole ?? ""}
                          onBlur={(e) => e.target.value !== (link.routingRole ?? "") && updateLink(link.agentId, { routingRole: e.target.value || null })}
                        />
                        <Input
                          placeholder="Priority"
                          type="number"
                          defaultValue={link.priority}
                          onBlur={(e) => Number(e.target.value) !== link.priority && updateLink(link.agentId, { priority: Number(e.target.value) || 0 })}
                        />
                      </div>
                      <Input
                        placeholder="When to route here (e.g. 'technical support, fault codes, troubleshooting')"
                        defaultValue={link.routingDescription ?? ""}
                        onBlur={(e) => e.target.value !== (link.routingDescription ?? "") && updateLink(link.agentId, { routingDescription: e.target.value || null })}
                      />
                    </div>
                  );
                })}
              </div>
              {unlinkedAgents.length > 0 && (
                <div className="flex gap-2 mt-2">
                  <select value={addAgentId} onChange={(e) => setAddAgentId(e.target.value)} className="flex-1 rounded-md border border-black/10 dark:border-white/15 bg-surface px-2.5 py-[7px] text-[13px]">
                    <option value="">Add an agent…</option>
                    {unlinkedAgents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" onClick={addAgent} disabled={!addAgentId}>
                    <Settings2 size={13} /> Add
                  </Button>
                </div>
              )}
            </div>
          )}

          <div>
            <p className="text-[11px] font-semibold text-ink-secondary uppercase tracking-wide mb-2">Embed snippet</p>
            <pre className="rounded-lg bg-black/[0.04] dark:bg-white/[0.06] p-3 text-[11.5px] overflow-x-auto">{snippet}</pre>
            <Button size="sm" variant="secondary" className="mt-2" onClick={copySnippet}>
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy snippet"}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
