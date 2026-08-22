import type { OAuthConnector, OAuthTokens } from "./types";

// REAL Meta WhatsApp Cloud API connector — LAUNCH_CHECKLIST.md "WhatsApp
// — real send + receive". Activated in registry.ts once META_APP_SECRET
// is set; see that file for the exact gate.
//
// Honest scope of what "real" means here: full Meta "Embedded Signup"
// (the JS-SDK popup that lets a business owner pick/create their own WABA
// inline) needs a Business Login Config ID issued from a Meta App
// dashboard and, for arbitrary external businesses, Meta App Review
// approval on the whatsapp_business_management/whatsapp_business_messaging
// permissions — neither is something this environment can create or test
// against. Instead, connecting here means the tenant pastes a permanent
// System User access token + phone_number_id + WABA id they generated
// themselves in Meta Business Manager (Business Settings -> System Users)
// — a legitimate, commonly-used integration pattern for the WhatsApp
// Cloud API, and the same one many smaller platforms ship before (or
// instead of) building full Embedded Signup. Every method below still
// makes a REAL Graph API call and fails honestly on bad credentials —
// nothing here is a hardcoded success. Swapping in real Embedded Signup
// later only changes getAuthorizationUrl()/exchangeAuthorizationCode();
// every other method (send, receive, webhook registration, connection
// test) stays exactly as built here.

const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

interface WhatsAppManualCredentials {
  accessToken: string;
  phoneNumberId: string;
  wabaId: string;
  businessName: string;
}

function parseCredentials(code: string): WhatsAppManualCredentials {
  let parsed: Partial<WhatsAppManualCredentials>;
  try {
    parsed = JSON.parse(code);
  } catch {
    throw new Error("Malformed WhatsApp connection payload");
  }
  const { accessToken, phoneNumberId, wabaId, businessName } = parsed;
  if (!accessToken || !phoneNumberId || !wabaId) {
    throw new Error("Missing access token, phone number ID, or WhatsApp Business Account ID");
  }
  return { accessToken, phoneNumberId, wabaId, businessName: businessName || "WhatsApp Business Account" };
}

export class RealWhatsAppConnector implements OAuthConnector {
  readonly provider = "whatsapp";
  readonly isMock = false;

  async getAuthorizationUrl(params: { tenantId: string; state: string; redirectUri: string }): Promise<string> {
    const url = new URL("/onboarding/whatsapp-connect", "http://internal.invalid");
    url.searchParams.set("state", params.state);
    url.searchParams.set("redirect_uri", params.redirectUri);
    return url.pathname + url.search;
  }

  async handleCallback(params: { code: string; state: string; expectedState: string }): Promise<{ ok: boolean; reason?: string }> {
    if (!params.state || params.state !== params.expectedState) return { ok: false, reason: "STATE_MISMATCH" };
    if (!params.code) return { ok: false, reason: "MISSING_CODE" };
    return { ok: true };
  }

  async exchangeAuthorizationCode(params: { code: string }): Promise<OAuthTokens & { externalAccountId: string; externalAccountName: string; extra?: Record<string, unknown> }> {
    const creds = parseCredentials(params.code);

    // Confirm the token actually works and pull the REAL verified display
    // name/number from Meta rather than trusting whatever the tenant typed
    // into the form — same "genuinely fails, never a hardcoded success"
    // rule the mock connector already documents for testConnection().
    const res = await fetch(`${GRAPH_BASE}/${creds.phoneNumberId}?fields=display_phone_number,verified_name&access_token=${encodeURIComponent(creds.accessToken)}`);
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(`Could not verify this WhatsApp phone number with Meta: ${detail}`);
    }
    const data = (await res.json()) as { display_phone_number?: string; verified_name?: string };

    return {
      accessToken: creds.accessToken,
      // WhatsApp Cloud API System User tokens are issued as permanent
      // (no expiry, no refresh flow) when generated with "Never expire" in
      // Business Manager — there's honestly nothing to set here. A token
      // generated with a time limit will simply start failing
      // testConnection() until the tenant reconnects with a new one.
      externalAccountId: creds.phoneNumberId,
      externalAccountName: `${data.verified_name ?? creds.businessName} (${data.display_phone_number ?? creds.phoneNumberId})`,
      // Both stashed here (not just wabaId) because testConnection()/
      // registerWebhooks() only ever receive `extra`, never the full
      // tokens object — see connect-flow.ts's call sites.
      extra: { wabaId: creds.wabaId, phoneNumberId: creds.phoneNumberId },
    };
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    // No refresh flow exists for WhatsApp Cloud API System User tokens —
    // see the comment on exchangeAuthorizationCode(). A caller reaching
    // this means something upstream assumed a refresh flow that doesn't
    // apply here; fail loudly rather than fabricate a token.
    throw new Error("WhatsApp System User tokens do not support refresh — reconnect with a new token instead.");
  }

  async revokeAccess(): Promise<{ ok: boolean }> {
    // Meta has no API to remotely revoke a System User token — that's an
    // action the business admin takes in Business Manager. Disconnecting
    // here only stops this platform from using the (still technically
    // valid) token; it does not invalidate it at Meta.
    return { ok: true };
  }

  async testConnection(accessToken: string, extra?: Record<string, unknown>): Promise<{ ok: boolean; detail?: string }> {
    const phoneNumberId = extra?.phoneNumberId as string | undefined;
    if (!phoneNumberId) {
      // testConnection() is called with just the WABA-id-bearing `extra`
      // right after exchange in connect-flow.ts; if this connector is ever
      // invoked outside that flow without `extra`, fail honestly instead
      // of guessing an endpoint.
      return { ok: false, detail: "No phone number on file for this connection" };
    }
    const res = await fetch(`${GRAPH_BASE}/${phoneNumberId}?fields=display_phone_number&access_token=${encodeURIComponent(accessToken)}`);
    if (!res.ok) return { ok: false, detail: await res.text().catch(() => res.statusText) };
    return { ok: true };
  }

  async getGrantedScopes(accessToken: string): Promise<string[]> {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) return [];
    const res = await fetch(`${GRAPH_BASE}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: { scopes?: string[] } };
    return data.data?.scopes ?? [];
  }

  async registerWebhooks(params: { accessToken: string; callbackUrl: string; extra?: Record<string, unknown> }): Promise<{ ok: boolean; detail?: string }> {
    const wabaId = params.extra?.wabaId as string | undefined;
    if (!wabaId) return { ok: false, detail: "No WhatsApp Business Account ID on file — cannot subscribe to webhooks" };
    // Subscribes THIS platform's Meta App to this WABA's events. The
    // callback URL + verify token themselves are configured once, in the
    // Meta App dashboard (App -> WhatsApp -> Configuration), not per-call —
    // Meta's API has no endpoint to set a webhook URL per WABA, only to
    // link/unlink a WABA to the app-level webhook that's already configured
    // there. `callbackUrl` is accepted for interface-shape consistency with
    // every other connector, but genuinely unused by this call — see
    // LAUNCH_CHECKLIST.md for the one-time dashboard step this assumes.
    void params.callbackUrl;
    const res = await fetch(`${GRAPH_BASE}/${wabaId}/subscribed_apps`, { method: "POST", headers: { Authorization: `Bearer ${params.accessToken}` } });
    if (!res.ok) return { ok: false, detail: await res.text().catch(() => res.statusText) };
    return { ok: true };
  }

  async unregisterWebhooks(accessToken: string, extra?: Record<string, unknown>): Promise<{ ok: boolean }> {
    const wabaId = extra?.wabaId as string | undefined;
    if (!wabaId) return { ok: true };
    const res = await fetch(`${GRAPH_BASE}/${wabaId}/subscribed_apps`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
    return { ok: res.ok };
  }
}
