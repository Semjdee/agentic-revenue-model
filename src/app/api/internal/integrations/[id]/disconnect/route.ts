import { NextRequest } from "next/server";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  await db
    .update(schema.integrations)
    .set({ status: "NOT_CONNECTED" })
    .where(and(eq(schema.integrations.tenantId, session.tenantId), eq(schema.integrations.provider, params.id)));

  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "integration.disconnected", entity: "integration", entityId: params.id });
  return jsonOk({ ok: true });
}
