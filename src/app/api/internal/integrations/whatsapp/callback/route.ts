import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { encryptSecret } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import { getOAuthConnector } from "@/integrations/oauth/whatsapp-mock-connector";
import { getOnboardingProgress, advanceOnboardingStep, logOnboardingEvent } from "@/modules/onboarding/service";

// docs/PHASE_2_EXTENSIONS_SPEC.md section 12 — "Callback route must
// implement spec section 12 in full": state validation, CSRF protection,
// tenant/workspace context validated server-side (never trust a tenant id
// from a query/body param — resolved from the signed session here, same
// discipline as requireTenantSession()), redirect URI validation,
// auth-code validation, audit logging. Section 13's webhook registration
// + testConnection() gate what actually reaches CONNECTED status — a
// failure at any stage below leaves the row at ERROR, never CONNECTED.
const bodySchema = z.object({
  code: z.string().min(1), // JSON blob from the mock consent step — see whatsapp-mock-connector.ts
  state: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [row] = await db
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.tenantId, session.tenantId), eq(schema.integrations.provider, "whatsapp")))
    .limit(1);
  if (!row || row.status !== "PENDING") {
    return jsonError("No pending WhatsApp connection for this workspace — start over from Connect WhatsApp.", 409);
  }

  const expectedState = (row.config as { state?: string } | null)?.state;
  const connector = getOAuthConnector("whatsapp");

  const callbackResult = await connector.handleCallback({ code: parsed.data.code, state: parsed.data.state, expectedState: expectedState ?? "" });
  if (!callbackResult.ok) {
    await db.update(schema.integrations).set({ status: "ERROR" }).where(eq(schema.integrations.id, row.id));
    await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "integration.connect_failed", entity: "integration", entityId: row.id, after: { reason: callbackResult.reason } });
    return jsonError(
      callbackResult.reason === "STATE_MISMATCH" ? "We couldn't verify that request — please try connecting again." : "We couldn't finish connecting WhatsApp.",
      400,
      callbackResult.reason
    );
  }

  const tokens = await connector.exchangeAuthorizationCode({ code: parsed.data.code });
  const scopes = await connector.getGrantedScopes(tokens.accessToken);

  // Register + verify webhooks BEFORE ever marking CONNECTED (spec
  // section 13 — "mark the integration connected only when configuration
  // is valid").
  const callbackUrl = `${process.env.APP_URL ?? ""}/api/public/webhooks/whatsapp`;
  const webhookResult = await connector.registerWebhooks({ accessToken: tokens.accessToken, callbackUrl });
  const testResult = await connector.testConnection(tokens.accessToken);

  if (!webhookResult.ok || !testResult.ok) {
    await db
      .update(schema.integrations)
      .set({ status: "ERROR", webhookStatus: webhookResult.ok ? "HEALTHY" : "FAILED" })
      .where(eq(schema.integrations.id, row.id));
    await logAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "integration.connect_failed",
      entity: "integration",
      entityId: row.id,
      after: { webhookDetail: webhookResult.detail, testDetail: testResult.detail },
    });
    return jsonError("We couldn't finish connecting WhatsApp.", 502, "VERIFICATION_FAILED");
  }

  await db.insert(schema.integrationCredentials).values({
    id: generateId(),
    tenantId: session.tenantId,
    integrationId: row.id,
    encryptedPayload: encryptSecret(JSON.stringify(tokens)),
  });

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

  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "integration.connected", entity: "integration", entityId: row.id, after: { provider: "whatsapp", externalAccountName: tokens.externalAccountName } });
  await logOnboardingEvent(session.tenantId, "channel_connected", { channel: "whatsapp" });

  // Only advance the wizard if this tenant is actually mid-onboarding at
  // the CHANNEL_CONNECT step — connecting WhatsApp later from the regular
  // Integrations page (outside onboarding) must not touch wizard state.
  const progress = await getOnboardingProgress(session.tenantId);
  if (progress && progress.currentStep === "CHANNEL_CONNECT") {
    await advanceOnboardingStep(session.tenantId, "CHANNEL_CONNECT", "HEALTH_CHECK");
  }

  return jsonOk({ ok: true, externalAccountName: tokens.externalAccountName });
}
