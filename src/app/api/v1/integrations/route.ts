import { NextRequest } from "next/server";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { jsonError, jsonOk, requireApiKey, rateLimit } from "@/lib/api";

export async function GET(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth) return jsonError("Invalid or missing API key", 401, "UNAUTHORIZED");
  if (!(await rateLimit(`v1-${auth.apiKeyId}`, 120, 60_000))) return jsonError("Rate limit exceeded", 429);
  const rows = await db.select().from(schema.integrations).where(eq(schema.integrations.tenantId, auth.tenantId));
  return jsonOk({ items: rows });
}
