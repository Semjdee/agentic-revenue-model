import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq, desc } from "drizzle-orm";
import { jsonError, jsonOk, requireApiKey, rateLimit } from "@/lib/api";

// /api/v1/contacts — reference implementation of the public API gateway
// pattern (spec section 19): API-key auth, tenant scoping, pagination,
// request validation, structured errors.
const createSchema = z.object({ name: z.string().optional(), email: z.string().email().optional(), phone: z.string().optional() });

export async function GET(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth) return jsonError("Invalid or missing API key", 401, "UNAUTHORIZED");
  if (!(await rateLimit(`v1-${auth.apiKeyId}`, 120, 60_000))) return jsonError("Rate limit exceeded", 429);

  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("pageSize") ?? 20)));

  const rows = await db
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.tenantId, auth.tenantId)))
    .orderBy(desc(schema.contacts.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return jsonOk({ items: rows, page, pageSize });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth) return jsonError("Invalid or missing API key", 401, "UNAUTHORIZED");

  const idempotencyKey = req.headers.get("idempotency-key");
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Validation failed", 422, "VALIDATION_ERROR");

  const id = generateId();
  await db.insert(schema.contacts).values({ id, tenantId: auth.tenantId, ...parsed.data });
  return jsonOk({ id, idempotencyKey: idempotencyKey ?? null }, 201);
}
