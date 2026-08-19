"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { OAuthMockConsentForm } from "@/components/oauth-mock-consent-form";

// DEMO/MOCK — see src/components/oauth-mock-consent-form.tsx and
// src/integrations/oauth/whatsapp-mock-connector.ts for what this stands
// in for. useSearchParams() requires a Suspense boundary for static
// prerendering (Next.js App Router).
export default function WhatsAppMockConsentPage() {
  return (
    <Suspense fallback={null}>
      <WhatsAppConsentInner />
    </Suspense>
  );
}

function WhatsAppConsentInner() {
  const params = useSearchParams();
  const state = params.get("state") ?? "";
  const returnTo = params.get("return_to") ?? "/onboarding";
  return (
    <OAuthMockConsentForm
      providerLabel="WhatsApp Business"
      brandColor="#25D366"
      brandLetter="W"
      callbackPath="/api/internal/integrations/whatsapp/callback"
      state={state}
      returnTo={returnTo}
      fields={[
        { key: "phone", label: "WhatsApp Business phone number", placeholder: "+256700000000" },
        { key: "businessName", label: "Business name", placeholder: "Your business name" },
      ]}
    />
  );
}
