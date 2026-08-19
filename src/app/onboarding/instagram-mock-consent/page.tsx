"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { OAuthMockConsentForm } from "@/components/oauth-mock-consent-form";

// DEMO/MOCK — see src/components/oauth-mock-consent-form.tsx and
// src/integrations/oauth/instagram-mock-connector.ts for what this stands
// in for.
export default function InstagramMockConsentPage() {
  return (
    <Suspense fallback={null}>
      <InstagramConsentInner />
    </Suspense>
  );
}

function InstagramConsentInner() {
  const params = useSearchParams();
  const state = params.get("state") ?? "";
  const returnTo = params.get("return_to") ?? "/onboarding";
  return (
    <OAuthMockConsentForm
      providerLabel="Instagram"
      brandColor="#E4405F"
      brandLetter="IG"
      callbackPath="/api/internal/integrations/instagram/callback"
      state={state}
      returnTo={returnTo}
      fields={[
        { key: "handle", label: "Instagram professional account handle", placeholder: "@yourbusiness" },
        { key: "displayName", label: "Account display name", placeholder: "Your business name" },
      ]}
    />
  );
}
