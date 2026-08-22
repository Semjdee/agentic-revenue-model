import type { OAuthConnector } from "./types";
import { MockWhatsAppConnector } from "./whatsapp-mock-connector";
import { MockInstagramConnector } from "./instagram-mock-connector";
import { RealWhatsAppConnector } from "./whatsapp-real-connector";

// Single factory for every OAuthConnector-backed provider — the routes
// under src/app/api/internal/integrations/**/connect and .../callback
// never instantiate a connector class directly, so adding a real
// (non-mock) connector later is a one-line change here, not a change at
// every call site. Extracted out of whatsapp-mock-connector.ts (where it
// originally lived, back when WhatsApp was the only provider) once
// Instagram needed the same factory.
//
// Real-vs-mock gate follows the same pattern as every other provider in
// this codebase (Anthropic/Flutterwave — modules/ai/index.ts,
// integrations/payments/flutterwave.ts): a platform-level credential
// present -> real connector class; absent -> mock. META_APP_SECRET is the
// gate here specifically because it's what the real connector needs to
// verify inbound webhook signatures and introspect tokens (see
// whatsapp-real-connector.ts and the public webhook route) — it's the
// one credential that's genuinely required regardless of which tenant is
// connecting, unlike the per-tenant access token/phone number, which each
// tenant supplies themselves at connect time.
export function getOAuthConnector(provider: string): OAuthConnector {
  switch (provider) {
    case "whatsapp":
      return process.env.META_APP_SECRET ? new RealWhatsAppConnector() : new MockWhatsAppConnector();
    case "instagram":
      return new MockInstagramConnector();
    default:
      throw new Error(`No OAuth connector registered for provider: ${provider}`);
  }
}
