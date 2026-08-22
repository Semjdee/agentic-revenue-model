"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { OAuthMockConsentForm } from "@/components/oauth-mock-consent-form";

// REAL WhatsApp connect screen — reached only when RealWhatsAppConnector
// is active (META_APP_SECRET set, see integrations/oauth/registry.ts).
// See whatsapp-real-connector.ts's header comment for exactly why this is
// a manual-credential form rather than Meta's Embedded Signup popup, and
// what the tenant needs to paste in here (a permanent System User access
// token, phone number ID, and WhatsApp Business Account ID, all generated
// in their own Meta Business Manager). useSearchParams() requires a
// Suspense boundary for static prerendering (Next.js App Router).
export default function WhatsAppConnectPage() {
  return (
    <Suspense fallback={null}>
      <WhatsAppConnectInner />
    </Suspense>
  );
}

function WhatsAppConnectInner() {
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
      helperText="From Meta Business Manager → Business Settings → System Users: a permanent access token, plus your phone number ID and WhatsApp Business Account ID from WhatsApp Manager."
      submitLabel="Connect WhatsApp"
      fields={[
        { key: "accessToken", label: "Permanent access token", placeholder: "EAAxxxxxxxxxxxxxxxxxxxxxxxxx" },
        { key: "phoneNumberId", label: "Phone number ID", placeholder: "1234567890" },
        { key: "wabaId", label: "WhatsApp Business Account ID", placeholder: "9876543210" },
        { key: "businessName", label: "Business name", placeholder: "Your business name" },
      ]}
    />
  );
}
