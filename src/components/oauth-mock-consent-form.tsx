"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

// Shared DEMO/MOCK authorization screen — stands in for a real provider's
// consent UI (Meta Embedded Signup, etc., docs/ONBOARDING_SPEC.md
// sections 6/8) since this environment has no live app to redirect to.
// Extracted from the WhatsApp-only version once Instagram needed the
// identical shell with different fields/branding — a real connector swap
// only changes what happens server-side
// (src/integrations/oauth/connect-flow.ts's completeOAuthCallback()),
// this component doesn't need to change at all.
export interface MockConsentField {
  key: string;
  label: string;
  placeholder?: string;
}

export function OAuthMockConsentForm({
  providerLabel,
  brandColor,
  brandLetter,
  callbackPath,
  fields,
  state,
  returnTo = "/onboarding",
}: {
  providerLabel: string;
  brandColor: string;
  brandLetter: string;
  callbackPath: string;
  fields: MockConsentField[];
  state: string;
  returnTo?: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(fields.map((f) => [f.key, ""])));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function authorize(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post(callbackPath, { code: JSON.stringify(values), state });
      router.push(returnTo);
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
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: brandColor }}>
            {brandLetter}
          </div>
          <div>
            <p className="text-[13px] font-semibold text-ink-primary">
              Connect {/^[aeiou]/i.test(providerLabel) ? "an" : "a"} {providerLabel} account
            </p>
            <p className="text-[11px] text-ink-muted">Demo authorization — no real {providerLabel} account needed</p>
          </div>
        </div>
        <form onSubmit={authorize} className="space-y-3">
          {fields.map((f) => (
            <div key={f.key}>
              <Label>{f.label}</Label>
              <Input required value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} placeholder={f.placeholder} />
            </div>
          ))}
          {error && <p className="text-[12.5px] text-status-critical">{error}</p>}
          <Button type="submit" disabled={loading || !state} className="w-full">
            {loading ? "Authorizing…" : "Authorize & Connect"}
          </Button>
          {!state && <p className="text-[11px] text-status-critical">Missing authorization state — go back and click Connect again.</p>}
        </form>
      </div>
    </div>
  );
}
