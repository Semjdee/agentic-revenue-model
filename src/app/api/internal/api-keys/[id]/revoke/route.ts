import { NextRequest } from "next/server";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  await db.update(schema.apiKeys).set({ revokedAt: new Date() }).where(and(eq(schema.apiKeys.id, params.id), eq(schema.apiKeys.tenantId, session.tenantId)));
  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "api_key.revoked", entity: "api_key", entityId: params.id });
  return jsonOk({ ok: true });
}
