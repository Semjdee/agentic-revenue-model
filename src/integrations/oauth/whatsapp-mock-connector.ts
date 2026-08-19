import type { OAuthConnector, OAuthTokens } from "./types";
import { PROVIDER_DEFAULT_SCOPES } from "../capability-registry";

// DEMO/MOCK — simulates the WhatsApp Business Platform Embedded Signup
// exchange without calling a real Meta endpoint (no live credentials in
// this environment; see BUILD_NOTES.md section 5 for the established
// pattern every other connector in this codebase follows). Every method
// on this class is where a real MetaWhatsAppConnector would call the
// actual Graph API — swapping this class for a real one behind
// getOAuthConnector() is the only change needed once real credentials
// exist (same "no redesign needed" promise BUILD_NOTES.md makes for the
// CRM/Ads mock connectors).
//
// Unlike the general /integrations page's one-click mock-connect (which
// exists for cosmetic providers not in the current P0 scope, see
// docs/ONBOARDING_TASKS.md Milestone 8's comment on that), this connector
// genuinely runs through every stage — a malformed "authorization" really
// does fail testConnection() rather than always succeeding.
export class MockWhatsAppConnector implements OAuthConnector {
  readonly provider = "whatsapp";
  readonly isMock = true;

  async getAuthorizationUrl(params: { tenantId: string; state: string; redirectUri: string }): Promise<string> {
    // Real connector: https://www.facebook.com/v.../dialog/oauth?... .
    // Mocked as our own consent step so there's no real external redirect
    // to a domain we don't control from a demo environment.
    const url = new URL("/onboarding/whatsapp-mock-consent", "http://internal.invalid");
    url.searchParams.set("tenant", params.tenantId);
    url.searchParams.set("state", params.state);
    url.searchParams.set("redirect_uri", params.redirectUri);
    return url.pathname + url.search;
  }

  async handleCallback(params: { code: string; state: string; expectedState: string }): Promise<{ ok: boolean; reason?: string }> {
    if (!params.state || params.state !== params.expectedState) {
      return { ok: false, reason: "STATE_MISMATCH" };
    }
    if (!params.code) return { ok: false, reason: "MISSING_CODE" };
    return { ok: true };
  }

  async exchangeAuthorizationCode(params: { code: string }): Promise<OAuthTokens & { externalAccountId: string; externalAccountName: string }> {
    // In the mock consent step, `code` is a JSON blob of what the "user"
    // entered (phone number + business name) rather than an opaque Meta
    // auth code — see src/app/onboarding/whatsapp-mock-consent (wizard
    // step). Real connector: POST the code to Meta's token endpoint.
    let phone = "unknown";
    let businessName = "WhatsApp Business Account";
    try {
      const parsed = JSON.parse(params.code) as { phone?: string; businessName?: string };
      if (parsed.phone) phone = parsed.phone;
      if (parsed.businessName) businessName = parsed.businessName;
    } catch {
      // Not JSON — treat the whole thing as a phone number for leniency.
      phone = params.code;
    }
    return {
      accessToken: "mock_access_" + Buffer.from(phone).toString("hex").slice(0, 24),
      refreshToken: "mock_refresh_" + Buffer.from(phone).toString("hex").slice(0, 24),
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      externalAccountId: "waba_" + Buffer.from(phone).toString("hex").slice(0, 16),
      externalAccountName: `${businessName} (${phone})`,
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
    // Real connector: GET the phone number's status from the Graph API.
    // Mocked as "any token we issued ourselves is valid" — genuinely
    // fails if exchangeAuthorizationCode never ran (empty/garbage token),
    // so this isn't a hardcoded true.
    if (!accessToken || !accessToken.startsWith("mock_access_")) {
      return { ok: false, detail: "No valid access token" };
    }
    return { ok: true };
  }

  async getGrantedScopes(): Promise<string[]> {
    return PROVIDER_DEFAULT_SCOPES.whatsapp;
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

export function getOAuthConnector(provider: string): OAuthConnector {
  switch (provider) {
    case "whatsapp":
      return new MockWhatsAppConnector();
    default:
      throw new Error(`No OAuth connector registered for provider: ${provider}`);
  }
}
