import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const campaigns = await db.select().from(schema.campaigns).where(eq(schema.campaigns.tenantId, session.tenantId));
  const adAccounts = await db.select().from(schema.adAccounts).where(eq(schema.adAccounts.tenantId, session.tenantId));
  return jsonOk({ campaigns, adAccounts });
}
