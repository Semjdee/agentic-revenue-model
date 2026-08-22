import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq } from "drizzle-orm";
import crypto from "crypto";
import { encryptSecret } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import { getOAuthConnector } from "./registry";
import { getOnboardingProgress, advanceOnboardingStep, logOnboardingEvent } from "@/modules/onboarding/service";

// Shared OAuth connect/callback logic for every OAuthConnector-backed
// provider (WhatsApp, Instagram, and TikTok once it lands —
// docs/ONBOARDING_TASKS.md backlog). Extracted here once a second
// provider (Instagram) needed the identical flow WhatsApp already had —
// each provider's route files under
// src/app/api/internal/integrations/<provider>/{connect,callback}/route.ts
// stay thin: they own the session/auth boundary (consistent with every
// other route in this codebase doing its own getSession() check) and
// just call these two functions with their provider name.
//
// docs/PHASE_2_EXTENSIONS_SPEC.md section 12's callback requirements
// (state validation, CSRF protection, tenant resolved from the signed
// session — never from a param, redirect URI validation, audit logging)
// and section 13's "never mark CONNECTED without webhook registration +
// a passing test" live here, once, for every provider that uses this
// flow — not re-implemented per provider.

interface Session {
  tenantId: string;
  userId: string;
}

/** Only ever allow an internal path, never an absolute/protocol-relative
 * URL — `returnTo` is caller-influenced (the /integrations page passes
 * its own path), and this value gets used in a client-side redirect, so
 * an unvalidated value here would be an open-redirect vector. */
function safeInternalPath(candidate: string, fallback: string): string {
  if (candidate.startsWith("/") && !candidate.startsWith("//") && !candidate.includes("://")) return candidate;
  return fallback;
}

export async function initiateOAuthConnect(session: Session, provider: string, category: string, mockConsentPath: string, returnToInput = "/onboarding") {
  const returnTo = safeInternalPath(returnToInput, "/onboarding");
  const state = crypto.randomBytes(24).toString("hex");

  const [existing] = await db
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.tenantId, session.tenantId), eq(schema.integrations.provider, provider)))
    .limit(1);

  const config = { state, redirectUri: mockConsentPath, initiatedByUserId: session.userId, returnTo };
  let integrationId: string;
  if (existing) {
    integrationId = existing.id;
    await db.update(schema.integrations).set({ status: "PENDING", config }).where(eq(schema.integrations.id, existing.id));
  } else {
    integrationId = generateId();
    await db.insert(schema.integrations).values({ id: integrationId, tenantId: session.tenantId, provider, category, status: "PENDING", isMock: true, config });
  }

  const connector = getOAuthConnector(provider);
  const authorizationUrl = await connector.getAuthorizationUrl({ tenantId: session.tenantId, state, redirectUri: mockConsentPath });
  // The mock consent page needs to know where to send the user back to
  // (the onboarding wizard vs. the standalone Integrations page) — real
  // providers don't need this since they redirect to *our* callback URL
  // directly, but our own mock consent screen is itself a page the user
  // needs routing back from afterward.
  const separator = authorizationUrl.includes("?") ? "&" : "?";
  return { authorizationUrl: `${authorizationUrl}${separator}return_to=${encodeURIComponent(returnTo)}`, state, integrationId };
}

export type OAuthCallbackResult =
  | { ok: true; externalAccountName: string }
  | { ok: false; status: number; message: string; code?: string };

export async function completeOAuthCallback(session: Session, provider: string, code: string, state: string): Promise<OAuthCallbackResult> {
  const [row] = await db
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.tenantId, session.tenantId), eq(schema.integrations.provider, provider)))
    .limit(1);
  if (!row || row.status !== "PENDING") {
    return { ok: false, status: 409, message: `No pending ${provider} connection for this workspace — start over from Connect.` };
  }

  const expectedState = (row.config as { state?: string } | null)?.state;
  const connector = getOAuthConnector(provider);

  const callbackResult = await connector.handleCallback({ code, state, expectedState: expectedState ?? "" });
  if (!callbackResult.ok) {
    await db.update(schema.integrations).set({ status: "ERROR" }).where(eq(schema.integrations.id, row.id));
    await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "integration.connect_failed", entity: "integration", entityId: row.id, after: { provider, reason: callbackResult.reason } });
    return {
      ok: false,
      status: 400,
      message: callbackResult.reason === "STATE_MISMATCH" ? "We couldn't verify that request — please try connecting again." : `We couldn't finish connecting ${provider}.`,
      code: callbackResult.reason,
    };
  }

  const tokens = await connector.exchangeAuthorizationCode({ code });
  const scopes = await connector.getGrantedScopes(tokens.accessToken);

  const callbackUrl = `${process.env.APP_URL ?? ""}/api/public/webhooks/${provider}`;
  const webhookResult = await connector.registerWebhooks({ accessToken: tokens.accessToken, callbackUrl, extra: tokens.extra });
  const testResult = await connector.testConnection(tokens.accessToken, tokens.extra);

  if (!webhookResult.ok || !testResult.ok) {
    await db.update(schema.integrations).set({ status: "ERROR", webhookStatus: webhookResult.ok ? "HEALTHY" : "FAILED" }).where(eq(schema.integrations.id, row.id));
    await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "integration.connect_failed", entity: "integration", entityId: row.id, after: { provider, webhookDetail: webhookResult.detail, testDetail: testResult.detail } });
    return { ok: false, status: 502, message: `We couldn't finish connecting ${provider}.`, code: "VERIFICATION_FAILED" };
  }

  await db.insert(schema.integrationCredentials).values({ id: generateId(), tenantId: session.tenantId, integrationId: row.id, encryptedPayload: encryptSecret(JSON.stringify(tokens)) });

  await db
    .update(schema.integrations)
    .set({
      status: "CONNECTED",
      externalAccountId: tokens.externalAccountId,
      externalAccountName: tokens.externalAccountName,
      scopes,
      webhookStatus: "HEALTHY",
      connectedByUserId: session.userId,
      lastSyncAt: new Date(),
    })
    .where(eq(schema.integrations.id, row.id));

  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "integration.connected", entity: "integration", entityId: row.id, after: { provider, externalAccountName: tokens.externalAccountName } });
  await logOnboardingEvent(session.tenantId, "channel_connected", { channel: provider });

  // Only advance the wizard if this tenant is mid-onboarding at the
  // CHANNEL_CONNECT step — connecting a channel later from the regular
  // Integrations page must not touch wizard state (same rule
  // src/app/api/internal/agents/route.ts's manual-creation onboarding
  // hook already follows).
  const progress = await getOnboardingProgress(session.tenantId);
  if (progress && progress.currentStep === "CHANNEL_CONNECT") {
    await advanceOnboardingStep(session.tenantId, "CHANNEL_CONNECT", "HEALTH_CHECK");
  }

  return { ok: true, externalAccountName: tokens.externalAccountName };
}
