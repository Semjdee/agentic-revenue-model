"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

// DEMO/MOCK authorization screen — stands in for Meta's real Embedded
// Signup UI (docs/ONBOARDING_SPEC.md section 6), since this environment
// has no live Meta app to redirect to. A real integration replaces this
// page with an actual `window.location.href = authorizationUrl` to
// Meta's consent screen; everything downstream (state validation, token
// exchange, webhook registration, testConnection) is unchanged either way
// — see src/app/api/internal/integrations/whatsapp/callback/route.ts.
export default function WhatsAppMockConsentPage() {
  // useSearchParams() requires a Suspense boundary for static prerendering
  // (Next.js App Router) — wrap the actual content, not the page shell.
  return (
    <Suspense fallback={null}>
      <WhatsAppMockConsentForm />
    </Suspense>
  );
}

function WhatsAppMockConsentForm() {
  const router = useRouter();
  const params = useSearchParams();
  const state = params.get("state") ?? "";
  const [phone, setPhone] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function authorize(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post("/api/internal/integrations/whatsapp/callback", {
        code: JSON.stringify({ phone, businessName }),
        state,
      });
      router.push("/onboarding");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete authorization");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-plane px-4">
      <div className="w-full max-w-sm card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#25D366] flex items-center justify-center text-white text-sm font-bold">W</div>
          <div>
            <p className="text-[13px] font-semibold text-ink-primary">Connect a WhatsApp Business Account</p>
            <p className="text-[11px] text-ink-muted">Demo authorization — no real Meta account needed</p>
          </div>
        </div>
        <form onSubmit={authorize} className="space-y-3">
          <div>
            <Label>WhatsApp Business phone number</Label>
            <Input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+256700000000" />
          </div>
          <div>
            <Label>Business name</Label>
            <Input required value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Your business name" />
          </div>
          {error && <p className="text-[12.5px] text-status-critical">{error}</p>}
          <Button type="submit" disabled={loading || !state} className="w-full">
            {loading ? "Authorizing…" : "Authorize & Connect"}
          </Button>
          {!state && <p className="text-[11px] text-status-critical">Missing authorization state — go back and click Connect WhatsApp again.</p>}
        </form>
      </div>
    </div>
  );
}
