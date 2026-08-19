"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

// DEMO/MOCK — see src/integrations/crm/mock-connector.ts. One page for
// every CRM provider (unlike WhatsApp/Instagram's dedicated pages) since
// MockCRMConnector is already provider-agnostic and every CRM provider
// needs the identical single field here — account/workspace name, never
// a raw API key/secret pasted into the UI (docs/ONBOARDING_SPEC.md
// section 3's rule against exposing technical config applies just as
// much to "Enter API token" for a CRM as it does to WhatsApp's Meta App
// ID).
const PROVIDER_LABELS: Record<string, { label: string; color: string; letter: string }> = {
  hubspot: { label: "HubSpot", color: "#FF7A59", letter: "H" },
  kommo: { label: "Kommo", color: "#2E7D32", letter: "K" },
  salesforce: { label: "Salesforce", color: "#00A1E0", letter: "S" },
  zoho: { label: "Zoho CRM", color: "#C8202F", letter: "Z" },
  odoo: { label: "Odoo", color: "#714B67", letter: "O" },
  custom_crm: { label: "Custom CRM", color: "#6B7280", letter: "C" },
};

export default function CRMMockConsentPage() {
  return (
    <Suspense fallback={null}>
      <CRMConsentInner />
    </Suspense>
  );
}

function CRMConsentInner() {
  const router = useRouter();
  const params = useSearchParams();
  const provider = params.get("provider") ?? "custom_crm";
  const state = params.get("state") ?? "";
  const returnTo = params.get("return_to") ?? "/integrations";
  const meta = PROVIDER_LABELS[provider] ?? PROVIDER_LABELS.custom_crm;

  const [accountName, setAccountName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function authorize(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post(`/api/internal/integrations/crm/${provider}/callback`, { accountName, state });
      router.push(returnTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete connection");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-plane px-4">
      <div className="w-full max-w-sm card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: meta.color }}>
            {meta.letter}
          </div>
          <div>
            <p className="text-[13px] font-semibold text-ink-primary">Connect {meta.label}</p>
            <p className="text-[11px] text-ink-muted">Demo authorization — no real {meta.label} account needed</p>
          </div>
        </div>
        <form onSubmit={authorize} className="space-y-3">
          <div>
            <Label>Which {meta.label} account should we connect?</Label>
            <Input required value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Your account or workspace name" />
          </div>
          {error && <p className="text-[12.5px] text-status-critical">{error}</p>}
          <Button type="submit" disabled={loading || !state} className="w-full">
            {loading ? "Connecting…" : "Authorize & Connect"}
          </Button>
          {!state && <p className="text-[11px] text-status-critical">Missing authorization state — go back and click Connect again.</p>}
        </form>
      </div>
    </div>
  );
}
