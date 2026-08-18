"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Copy, Check } from "lucide-react";
import { WEBHOOK_EVENTS } from "@/db/schema";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}
interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  status: string;
}

const ROUTES = [
  "GET/POST /api/v1/contacts",
  "GET/POST /api/v1/leads",
  "GET/POST /api/v1/opportunities",
  "GET/POST /api/v1/products",
  "GET /api/v1/conversations",
  "GET /api/v1/sales",
  "GET/POST /api/v1/tasks",
  "GET /api/v1/agents",
  "GET /api/v1/campaigns",
  "GET /api/v1/attribution",
  "GET /api/v1/recommendations",
  "GET /api/v1/integrations",
  "GET/POST /api/v1/webhooks",
];

export default function DevelopersPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [whDialogOpen, setWhDialogOpen] = useState(false);
  const [whUrl, setWhUrl] = useState("");
  const [whEvents, setWhEvents] = useState<string[]>([]);

  async function load() {
    setKeys(await api.get<ApiKey[]>("/api/internal/api-keys"));
    setWebhooks(await api.get<WebhookEndpoint[]>("/api/internal/webhooks"));
  }
  useEffect(() => {
    load();
  }, []);

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    const res = await api.post<{ apiKey: string }>("/api/internal/api-keys", { name: newKeyName });
    setRevealedKey(res.apiKey);
    setNewKeyName("");
    load();
  }

  async function revoke(id: string) {
    await api.post(`/api/internal/api-keys/${id}/revoke`);
    load();
  }

  async function createWebhook(e: React.FormEvent) {
    e.preventDefault();
    await api.post("/api/internal/webhooks", { url: whUrl, events: whEvents });
    setWhDialogOpen(false);
    setWhUrl("");
    setWhEvents([]);
    load();
  }

  async function deleteWebhook(id: string) {
    await api.del(`/api/internal/webhooks/${id}`);
    load();
  }

  return (
    <div className="pb-12">
      <PageHeader title="Developers / API" description="API keys, webhooks, and the REST gateway that lets external apps connect." />
      <div className="px-5 md:px-8 space-y-8">
        <section>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[13px] font-semibold text-ink-primary">API Keys</p>
            <Button size="sm" onClick={() => setKeyDialogOpen(true)}>
              <Plus size={14} /> Create key
            </Button>
          </div>
          <div className="card divide-y divide-black/[0.05] dark:divide-white/[0.05]">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <p className="text-[13px] text-ink-primary font-medium">{k.name}</p>
                  <p className="text-[11.5px] text-ink-muted font-mono">{k.prefix}.••••••••</p>
                </div>
                {k.revokedAt ? <Badge tone="critical">Revoked</Badge> : <Button size="sm" variant="secondary" onClick={() => revoke(k.id)}>Revoke</Button>}
              </div>
            ))}
            {keys.length === 0 && <p className="text-[12.5px] text-ink-muted p-4">No API keys yet.</p>}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[13px] font-semibold text-ink-primary">Webhooks</p>
            <Button size="sm" onClick={() => setWhDialogOpen(true)}>
              <Plus size={14} /> Add endpoint
            </Button>
          </div>
          <div className="card divide-y divide-black/[0.05] dark:divide-white/[0.05]">
            {webhooks.map((w) => (
              <div key={w.id} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <p className="text-[13px] text-ink-primary font-medium">{w.url}</p>
                  <p className="text-[11.5px] text-ink-muted">{w.events.length} event(s) subscribed</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => deleteWebhook(w.id)}>
                  Remove
                </Button>
              </div>
            ))}
            {webhooks.length === 0 && <p className="text-[12.5px] text-ink-muted p-4">No webhook endpoints yet.</p>}
          </div>
        </section>

        <section>
          <p className="text-[13px] font-semibold text-ink-primary mb-2">API Documentation</p>
          <div className="card p-4">
            <p className="text-[12.5px] text-ink-secondary mb-2">
              Authenticate with <code>Authorization: Bearer &lt;api_key&gt;</code>. All routes are tenant-scoped, versioned under <code>/api/v1</code>, and support pagination via
              <code> ?page=&amp;pageSize=</code>.
            </p>
            <div className="grid sm:grid-cols-2 gap-1.5 mt-3">
              {ROUTES.map((r) => (
                <code key={r} className="text-[11.5px] bg-black/[0.04] dark:bg-white/10 rounded px-2 py-1 text-ink-secondary">
                  {r}
                </code>
              ))}
            </div>
          </div>
        </section>
      </div>

      <Dialog
        open={keyDialogOpen}
        onOpenChange={(o) => {
          setKeyDialogOpen(o);
          if (!o) setRevealedKey(null);
        }}
        title="Create API Key"
      >
        {revealedKey ? (
          <div className="space-y-3">
            <p className="text-[12.5px] text-ink-secondary">Copy this now — it won&apos;t be shown again.</p>
            <div className="relative">
              <pre className="bg-black text-white text-[12px] rounded-lg p-3 overflow-x-auto">{revealedKey}</pre>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(revealedKey);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="absolute top-2 right-2 p-1.5 rounded-md bg-white/10 text-white hover:bg-white/20"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </div>
            <Button className="w-full" onClick={() => setKeyDialogOpen(false)}>
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={createKey} className="space-y-4">
            <div>
              <Label>Key name</Label>
              <Input required value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="e.g. Zapier integration" />
            </div>
            <Button type="submit" className="w-full">
              Generate key
            </Button>
          </form>
        )}
      </Dialog>

      <Dialog open={whDialogOpen} onOpenChange={setWhDialogOpen} title="Add Webhook Endpoint">
        <form onSubmit={createWebhook} className="space-y-4">
          <div>
            <Label>Endpoint URL</Label>
            <Input required type="url" value={whUrl} onChange={(e) => setWhUrl(e.target.value)} placeholder="https://your-app.com/webhooks/ai-revenue-agent" />
          </div>
          <div>
            <Label>Events</Label>
            <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto scrollbar-thin border border-black/10 dark:border-white/10 rounded-lg p-2">
              {WEBHOOK_EVENTS.map((ev) => (
                <label key={ev} className="flex items-center gap-1.5 text-[11.5px] text-ink-secondary">
                  <input
                    type="checkbox"
                    checked={whEvents.includes(ev)}
                    onChange={(e) => setWhEvents((prev) => (e.target.checked ? [...prev, ev] : prev.filter((x) => x !== ev)))}
                  />
                  {ev}
                </label>
              ))}
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={!whEvents.length}>
            Create endpoint
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
