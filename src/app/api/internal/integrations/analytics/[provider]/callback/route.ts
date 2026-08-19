import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { encryptSecret } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import { getOrganicSearchConnector } from "@/integrations/analytics/search-console-mock-connector";

const bodySchema = z.object({ accountName: z.string().min(1), state: z.string().min(1) });

export async function POST(req: NextRequest, { params }: { params: { provider: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (params.provider !== "google_search_console") return jsonError("Unknown analytics provider", 404);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [row] = await db
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.tenantId, session.tenantId), eq(schema.integrations.provider, params.provider)))
    .limit(1);
  if (!row || row.status !== "PENDING") {
    return jsonError("No pending connection for this workspace — start over from Connect.", 409);
  }

  const expectedState = (row.config as { state?: string } | null)?.state;
  if (!parsed.data.state || parsed.data.state !== expectedState) {
    await db.update(schema.integrations).set({ status: "ERROR" }).where(eq(schema.integrations.id, row.id));
    await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "integration.connect_failed", entity: "integration", entityId: row.id, after: { provider: params.provider, reason: "STATE_MISMATCH" } });
    return jsonError("We couldn't verify that request — please try connecting again.", 400, "STATE_MISMATCH");
  }

  const connector = getOrganicSearchConnector();
  const credentials = { propertyUrl: parsed.data.accountName };

  const authResult = await connector.authenticate(credentials);
  const testResult = authResult.ok ? await connector.testConnection() : { ok: false, detail: undefined as string | undefined };

  if (!authResult.ok || !testResult.ok) {
    await db.update(schema.integrations).set({ status: "ERROR" }).where(eq(schema.integrations.id, row.id));
    await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "integration.connect_failed", entity: "integration", entityId: row.id, after: { provider: params.provider, testDetail: testResult.detail } });
    return jsonError("We couldn't finish connecting Google Search Console.", 502, "VERIFICATION_FAILED");
  }

  // Reconnecting (e.g. after a revoke) replaces the backfill rather than
  // appending a second overlapping set for the same dates.
  await db.delete(schema.searchConsoleSnapshots).where(eq(schema.searchConsoleSnapshots.integrationId, row.id));

  const snapshots = await connector.getSnapshots(30);
  for (const s of snapshots) {
    await db.insert(schema.searchConsoleSnapshots).values({
      id: generateId(),
      tenantId: session.tenantId,
      integrationId: row.id,
      date: s.date,
      impressions: s.impressions,
      clicks: s.clicks,
      avgPosition: s.avgPosition.toString(),
      topQueries: s.topQueries,
    });
  }

  await db.insert(schema.integrationCredentials).values({ id: generateId(), tenantId: session.tenantId, integrationId: row.id, encryptedPayload: encryptSecret(JSON.stringify(credentials)) });

  await db
    .update(schema.integrations)
    .set({
      status: "CONNECTED",
      externalAccountId: parsed.data.accountName.toLowerCase().replace(/\s+/g, "-"),
      externalAccountName: parsed.data.accountName,
      webhookStatus: null,
      connectedByUserId: session.userId,
      lastSyncAt: new Date(),
    })
    .where(eq(schema.integrations.id, row.id));

  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "integration.connected", entity: "integration", entityId: row.id, after: { provider: params.provider, externalAccountName: parsed.data.accountName } });

  return jsonOk({ ok: true, externalAccountName: parsed.data.accountName });
}
