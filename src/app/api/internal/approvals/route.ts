import { db, schema } from "@/db/client";
import { and, eq, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";

// Pending approvals — covers both AI agent actions flagged
// APPROVAL_REQUIRED (spec section 7, e.g. "offer discount") and advertising
// recommendations awaiting a budget-change decision (section 15).
export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const rows = await db
    .select()
    .from(schema.approvals)
    .where(and(eq(schema.approvals.tenantId, session.tenantId), eq(schema.approvals.status, "PENDING")))
    .orderBy(desc(schema.approvals.createdAt));
  return jsonOk(rows);
}
