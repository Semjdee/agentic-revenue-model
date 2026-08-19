import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { encryptSecret } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import { getCRMConnector, CRM_PROVIDERS } from "@/integrations/crm/mock-connector";

// docs/PHASE_2_EXTENSIONS_SPEC.md section 12's discipline applied to CRM:
// state validation, tenant resolved from the signed session only, and —
// per section 13 — never marked CONNECTED unless authenticate() AND
// testConnection() AND registerWebhooks() all genuinely succeed.
const bodySchema = z.object({
  accountName: z.string().min(1),
  state: z.string().min(1),
});

export async function POST(req: NextRequest, { params }: { params: { provider: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!(CRM_PROVIDERS as readonly string[]).includes(params.provider)) return jsonError("Unknown CRM provider", 404);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [row] = await db
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.tenantId, session.tenantId), eq(schema.integrations.provider, params.provider)))
    .limit(1);
  if (!row || row.status !== "PENDING") {
    return jsonError(`No pending ${params.provider} connection for this workspace — start over from Connect.`, 409);
  }

  const expectedState = (row.config as { state?: string } | null)?.state;
  if (!parsed.data.state || parsed.data.state !== expectedState) {
    await db.update(schema.integrations).set({ status: "ERROR" }).where(eq(schema.integrations.id, row.id));
    await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "integration.connect_failed", entity: "integration", entityId: row.id, after: { provider: params.provider, reason: "STATE_MISMATCH" } });
    return jsonError("We couldn't verify that request — please try connecting again.", 400, "STATE_MISMATCH");
  }

  const connector = getCRMConnector(params.provider);
  const credentials = { accountName: parsed.data.accountName };

  const authResult = await connector.authenticate(credentials);
  const testResult = authResult.ok ? await connector.testConnection() : { ok: false, message: undefined as string | undefined };
  const webhookResult = testResult.ok ? await connector.registerWebhooks(`${process.env.APP_URL ?? ""}/api/public/webhooks/crm/${params.provider}`) : { ok: false };

  if (!authResult.ok || !testResult.ok || !webhookResult.ok) {
    await db.update(schema.integrations).set({ status: "ERROR" }).where(eq(schema.integrations.id, row.id));
    await logAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "integration.connect_failed",
      entity: "integration",
      entityId: row.id,
      after: { provider: params.provider, authDetail: authResult.message, testDetail: testResult.message },
    });
    return jsonError(`We couldn't finish connecting ${params.provider}.`, 502, "VERIFICATION_FAILED");
  }

  await db.insert(schema.integrationCredentials).values({ id: generateId(), tenantId: session.tenantId, integrationId: row.id, encryptedPayload: encryptSecret(JSON.stringify(credentials)) });

  await db
    .update(schema.integrations)
    .set({
      status: "CONNECTED",
      externalAccountId: parsed.data.accountName.toLowerCase().replace(/\s+/g, "-"),
      externalAccountName: parsed.data.accountName,
      webhookStatus: "HEALTHY",
      connectedByUserId: session.userId,
      lastSyncAt: new Date(),
    })
    .where(eq(schema.integrations.id, row.id));

  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "integration.connected", entity: "integration", entityId: row.id, after: { provider: params.provider, externalAccountName: parsed.data.accountName } });

  return jsonOk({ ok: true, externalAccountName: parsed.data.accountName });
}
