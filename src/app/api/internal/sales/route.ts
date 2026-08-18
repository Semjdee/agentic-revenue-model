import { db, schema } from "@/db/client";
import { eq, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const rows = await db.select().from(schema.sales).where(eq(schema.sales.tenantId, session.tenantId)).orderBy(desc(schema.sales.closedAt));
  return jsonOk(rows);
}
