import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { eq, desc } from "drizzle-orm";
import { jsonError, jsonOk, requireApiKey, rateLimit } from "@/lib/api";

const createSchema = z.object({ contactId: z.string(), leadId: z.string().optional(), estimatedValue: z.string().optional() });

export async function GET(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth) return jsonError("Invalid or missing API key", 401, "UNAUTHORIZED");
  if (!(await rateLimit(`v1-${auth.apiKeyId}`, 120, 60_000))) return jsonError("Rate limit exceeded", 429);
  const rows = await db.select().from(schema.opportunities).where(eq(schema.opportunities.tenantId, auth.tenantId)).orderBy(desc(schema.opportunities.createdAt)).limit(100);
  return jsonOk({ items: rows });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth) return jsonError("Invalid or missing API key", 401, "UNAUTHORIZED");
  if (!(await rateLimit(`v1-${auth.apiKeyId}`, 120, 60_000))) return jsonError("Rate limit exceeded", 429);
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Validation failed", 422, "VALIDATION_ERROR");
  const id = generateId();
  await db.insert(schema.opportunities).values({ id, tenantId: auth.tenantId, ...parsed.data });
  return jsonOk({ id }, 201);
}
