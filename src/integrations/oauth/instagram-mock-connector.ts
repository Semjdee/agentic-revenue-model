import type { OAuthConnector, OAuthTokens } from "./types";
import { PROVIDER_DEFAULT_SCOPES } from "../capability-registry";

// DEMO/MOCK — simulates Meta's Instagram professional-account OAuth
// exchange without calling a real Graph API endpoint (same established
// pattern as MockWhatsAppConnector in ./whatsapp-mock-connector.ts and
// every other mock connector in this codebase — see BUILD_NOTES.md
// section 5). docs/ONBOARDING_SPEC.md section 8: "Official Meta/Instagram
// authorization only. Never request the customer's Instagram password
// directly" — this connector never asks for one; the mock consent step
// (src/app/onboarding/instagram-mock-consent/page.tsx) collects an
// account handle + display name, standing in for "select professional
// account" in a real Embedded Signup-style flow.
export class MockInstagramConnector implements OAuthConnector {
  readonly provider = "instagram";
  readonly isMock = true;

  async getAuthorizationUrl(params: { tenantId: string; state: string; redirectUri: string }): Promise<string> {
    const url = new URL("/onboarding/instagram-mock-consent", "http://internal.invalid");
    url.searchParams.set("tenant", params.tenantId);
    url.searchParams.set("state", params.state);
    url.searchParams.set("redirect_uri", params.redirectUri);
    return url.pathname + url.search;
  }

  async handleCallback(params: { code: string; state: string; expectedState: string }): Promise<{ ok: boolean; reason?: string }> {
    if (!params.state || params.state !== params.expectedState) return { ok: false, reason: "STATE_MISMATCH" };
    if (!params.code) return { ok: false, reason: "MISSING_CODE" };
    return { ok: true };
  }

  async exchangeAuthorizationCode(params: { code: string }): Promise<OAuthTokens & { externalAccountId: string; externalAccountName: string }> {
    let handle = "unknown";
    let displayName = "Instagram Professional Account";
    try {
      const parsed = JSON.parse(params.code) as { handle?: string; displayName?: string };
      if (parsed.handle) handle = parsed.handle.replace(/^@/, "");
      if (parsed.displayName) displayName = parsed.displayName;
    } catch {
      handle = params.code.replace(/^@/, "");
    }
    return {
      accessToken: "mock_access_" + Buffer.from(handle).toString("hex").slice(0, 24),
      refreshToken: "mock_refresh_" + Buffer.from(handle).toString("hex").slice(0, 24),
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      externalAccountId: "ig_" + Buffer.from(handle).toString("hex").slice(0, 16),
      externalAccountName: `@${handle} (${displayName})`,
    };
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    return {
      accessToken: "mock_access_" + refreshToken.slice(-16),
      refreshToken,
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  async revokeAccess(): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async testConnection(accessToken: string): Promise<{ ok: boolean; detail?: string }> {
    if (!accessToken || !accessToken.startsWith("mock_access_")) return { ok: false, detail: "No valid access token" };
    return { ok: true };
  }

  async getGrantedScopes(): Promise<string[]> {
    return PROVIDER_DEFAULT_SCOPES.instagram;
  }

  async registerWebhooks(params: { accessToken: string; callbackUrl: string }): Promise<{ ok: boolean; detail?: string }> {
    if (!params.accessToken.startsWith("mock_access_")) return { ok: false, detail: "Cannot register webhooks without a valid connection" };
    if (!params.callbackUrl) return { ok: false, detail: "No callback URL configured" };
    return { ok: true };
  }

  async unregisterWebhooks(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
}
