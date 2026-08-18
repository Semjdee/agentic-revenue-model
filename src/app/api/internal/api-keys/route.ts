import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { generateId, generateApiKeyPair } from "@/lib/ids";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hashApiKeySecret } from "@/lib/crypto";
import { hasPermission } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

const bodySchema = z.object({ name: z.string().min(1), scopes: z.array(z.string()).default(["read", "write"]) });

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const rows = await db
    .select({ id: schema.apiKeys.id, name: schema.apiKeys.name, prefix: schema.apiKeys.prefix, scopes: schema.apiKeys.scopes, lastUsedAt: schema.apiKeys.lastUsedAt, revokedAt: schema.apiKeys.revokedAt, createdAt: schema.apiKeys.createdAt })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.tenantId, session.tenantId));
  return jsonOk(rows);
}

// Returns the full secret ONLY once, at creation time — never retrievable
// again (spec section 34: never log access tokens/API secrets; only the
// hash is stored).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "developer", "create")) return jsonError("Forbidden", 403);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const { prefix, secret, full } = generateApiKeyPair();
  const id = generateId();
  await db.insert(schema.apiKeys).values({
    id,
    tenantId: session.tenantId,
    name: parsed.data.name,
    prefix,
    hashedKey: hashApiKeySecret(secret),
    scopes: parsed.data.scopes,
    createdBy: session.userId,
  });

  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "api_key.created", entity: "api_key", entityId: id, after: { name: parsed.data.name, prefix } });

  return jsonOk({ id, apiKey: full }, 201);
}
