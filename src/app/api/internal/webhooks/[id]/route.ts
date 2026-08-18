import { NextRequest } from "next/server";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  await db.delete(schema.webhookEndpoints).where(and(eq(schema.webhookEndpoints.id, params.id), eq(schema.webhookEndpoints.tenantId, session.tenantId)));
  return jsonOk({ ok: true });
}
