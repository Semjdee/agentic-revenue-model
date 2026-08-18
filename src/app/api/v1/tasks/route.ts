import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { eq, desc } from "drizzle-orm";
import { jsonError, jsonOk, requireApiKey, rateLimit } from "@/lib/api";

const createSchema = z.object({ title: z.string().min(1), opportunityId: z.string().optional(), dueAt: z.string().optional() });

export async function GET(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth) return jsonError("Invalid or missing API key", 401, "UNAUTHORIZED");
  if (!(await rateLimit(`v1-${auth.apiKeyId}`, 120, 60_000))) return jsonError("Rate limit exceeded", 429);
  const rows = await db.select().from(schema.tasks).where(eq(schema.tasks.tenantId, auth.tenantId)).orderBy(desc(schema.tasks.createdAt)).limit(100);
  return jsonOk({ items: rows });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth) return jsonError("Invalid or missing API key", 401, "UNAUTHORIZED");
  if (!(await rateLimit(`v1-${auth.apiKeyId}`, 120, 60_000))) return jsonError("Rate limit exceeded", 429);
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Validation failed", 422, "VALIDATION_ERROR");
  const id = generateId();
  await db.insert(schema.tasks).values({ id, tenantId: auth.tenantId, title: parsed.data.title, opportunityId: parsed.data.opportunityId, dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null });
  return jsonOk({ id }, 201);
}
