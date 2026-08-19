import type { OAuthConnector } from "./types";
import { MockWhatsAppConnector } from "./whatsapp-mock-connector";
import { MockInstagramConnector } from "./instagram-mock-connector";

// Single factory for every OAuthConnector-backed provider — the routes
// under src/app/api/internal/integrations/**/connect and .../callback
// never instantiate a connector class directly, so adding a real
// (non-mock) connector later is a one-line change here, not a change at
// every call site. Extracted out of whatsapp-mock-connector.ts (where it
// originally lived, back when WhatsApp was the only provider) once
// Instagram needed the same factory.
export function getOAuthConnector(provider: string): OAuthConnector {
  switch (provider) {
    case "whatsapp":
      return new MockWhatsAppConnector();
    case "instagram":
      return new MockInstagramConnector();
    default:
      throw new Error(`No OAuth connector registered for provider: ${provider}`);
  }
}
