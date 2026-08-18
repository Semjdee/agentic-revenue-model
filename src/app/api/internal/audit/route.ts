import { db, schema } from "@/db/client";
import { eq, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "audit", "view")) return jsonError("Forbidden", 403);
  const rows = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.tenantId, session.tenantId)).orderBy(desc(schema.auditLogs.timestamp)).limit(200);
  return jsonOk(rows);
}
