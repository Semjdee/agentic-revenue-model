import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { encryptSecret } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";

const bodySchema = z.object({ category: z.string(), credentials: z.record(z.string(), z.string()).optional() });

// `params.id` here is the integration *provider* key (e.g. "hubspot"),
// not a DB id — connecting creates the row. Since this sandbox has no real
// third-party credentials, every connection is a labelled DEMO/MOCK
// connector (spec section 37); credentials, if supplied, are still
// encrypted at rest exactly as a real integration's would be.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "integrations", "edit")) return jsonError("Forbidden", 403);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [existing] = await db
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.tenantId, session.tenantId), eq(schema.integrations.provider, params.id)))
    .limit(1);

  let integrationId = existing?.id;
  if (existing) {
    await db.update(schema.integrations).set({ status: "CONNECTED", lastSyncAt: new Date() }).where(eq(schema.integrations.id, existing.id));
  } else {
    integrationId = generateId();
    await db.insert(schema.integrations).values({
      id: integrationId,
      tenantId: session.tenantId,
      provider: params.id,
      category: parsed.data.category,
      status: "CONNECTED",
      isMock: true,
      lastSyncAt: new Date(),
    });
  }

  if (parsed.data.credentials && Object.keys(parsed.data.credentials).length && integrationId) {
    await db.insert(schema.integrationCredentials).values({
      id: generateId(),
      tenantId: session.tenantId,
      integrationId,
      encryptedPayload: encryptSecret(JSON.stringify(parsed.data.credentials)),
    });
  }

  // Never log credential values — only that a connection event happened.
  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "integration.connected", entity: "integration", entityId: integrationId });

  return jsonOk({ ok: true, isMock: true });
}
