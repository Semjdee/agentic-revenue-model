// Generic OAuth/authorization connector interface — docs/PHASE_2_EXTENSIONS_SPEC.md
// section 6, built here because docs/ONBOARDING_SPEC.md Milestone 8
// (WhatsApp self-connect) needs it first. Modeled on the shape of
// src/integrations/advertising/types.ts's AdsConnector — same spirit, this
// is the social/messaging equivalent. UI components never call a
// connector directly; only API routes under src/app/api/internal/integrations/**
// do.

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string; // ISO timestamp
}

export interface OAuthConnector {
  readonly provider: string;
  readonly isMock: boolean;

  /** Where to send the user to authorize (real connector: the provider's
   * consent screen). Must embed an unguessable `state` for CSRF
   * protection — the caller is responsible for persisting `state` against
   * the session before redirecting, and validating it in handleCallback(). */
  getAuthorizationUrl(params: { tenantId: string; state: string; redirectUri: string }): Promise<string>;

  /** Validates the callback's `state` against what was issued. Real
   * connector: also validates the redirect URI matches what was
   * registered. Never trust a tenant id passed in a query/body param here
   * — the caller resolves tenant from the signed session, not from
   * anything this method receives. */
  handleCallback(params: { code: string; state: string; expectedState: string }): Promise<{ ok: boolean; reason?: string }>;

  exchangeAuthorizationCode(params: { code: string }): Promise<OAuthTokens & { externalAccountId: string; externalAccountName: string }>;

  refreshToken(refreshToken: string): Promise<OAuthTokens>;

  revokeAccess(accessToken: string): Promise<{ ok: boolean }>;

  /** Real check against the provider — must fail honestly if the
   * connection isn't actually usable, never a hardcoded success (spec
   * section 35). */
  testConnection(accessToken: string): Promise<{ ok: boolean; detail?: string }>;

  getGrantedScopes(accessToken: string): Promise<string[]>;

  registerWebhooks(params: { accessToken: string; callbackUrl: string }): Promise<{ ok: boolean; detail?: string }>;

  unregisterWebhooks(accessToken: string): Promise<{ ok: boolean }>;
}
