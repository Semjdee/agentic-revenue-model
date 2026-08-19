"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

// DEMO/MOCK — one shared consent page for every self-onboardable
// advertising/analytics provider (Instagram/Facebook/Google/TikTok Ads +
// Google Search Console), same "one page, provider-agnostic connector"
// pattern as src/app/onboarding/crm-mock-consent. Routes the callback to
// /api/internal/integrations/ads/<provider> or
// .../analytics/<provider> depending on which catalog the provider is in.
const PROVIDER_META: Record<string, { label: string; color: string; letter: string; fieldLabel: string; placeholder: string; namespace: "ads" | "analytics" }> = {
  instagram_ads: { label: "Instagram Ads", color: "#E1306C", letter: "I", fieldLabel: "Which Instagram Business account?", placeholder: "e.g. raygrid.solar", namespace: "ads" },
  facebook_ads: { label: "Facebook Ads", color: "#1877F2", letter: "F", fieldLabel: "Which Facebook Ad Account?", placeholder: "e.g. RayGrid Solar Energy", namespace: "ads" },
  google_ads: { label: "Google Ads", color: "#4285F4", letter: "G", fieldLabel: "Which Google Ads account?", placeholder: "e.g. RayGrid Solar — Google Ads", namespace: "ads" },
  tiktok_ads: { label: "TikTok Ads", color: "#000000", letter: "T", fieldLabel: "Which TikTok Business account?", placeholder: "e.g. raygrid.solar", namespace: "ads" },
  google_search_console: {
    label: "Google Search (Organic)",
    color: "#34A853",
    letter: "S",
    fieldLabel: "Which website property?",
    placeholder: "e.g. https://raygridsolar.com",
    namespace: "analytics",
  },
};

export default function AnalyticsMockConsentPage() {
  return (
    <Suspense fallback={null}>
      <AnalyticsConsentInner />
    </Suspense>
  );
}

function AnalyticsConsentInner() {
  const router = useRouter();
  const params = useSearchParams();
  const provider = params.get("provider") ?? "";
  const state = params.get("state") ?? "";
  const returnTo = params.get("return_to") ?? "/integrations";
  const meta = PROVIDER_META[provider];

  const [accountName, setAccountName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!meta) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-plane px-4">
        <p className="text-[13px] text-status-critical">Unknown provider — go back to Integrations and try again.</p>
      </div>
    );
  }

  async function authorize(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post(`/api/internal/integrations/${meta.namespace}/${provider}/callback`, { accountName, state });
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
            <Label>{meta.fieldLabel}</Label>
            <Input required value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder={meta.placeholder} />
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
