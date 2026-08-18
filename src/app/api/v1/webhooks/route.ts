import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { generateId, generateWebhookSecret } from "@/lib/ids";
import { eq } from "drizzle-orm";
import { jsonError, jsonOk, requireApiKey, rateLimit } from "@/lib/api";
import { WEBHOOK_EVENTS } from "@/db/schema";

const createSchema = z.object({ url: z.string().url(), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1) });

export async function GET(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth) return jsonError("Invalid or missing API key", 401, "UNAUTHORIZED");
  if (!(await rateLimit(`v1-${auth.apiKeyId}`, 120, 60_000))) return jsonError("Rate limit exceeded", 429);
  const rows = await db.select().from(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.tenantId, auth.tenantId));
  return jsonOk({ items: rows });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth) return jsonError("Invalid or missing API key", 401, "UNAUTHORIZED");
  if (!(await rateLimit(`v1-${auth.apiKeyId}`, 120, 60_000))) return jsonError("Rate limit exceeded", 429);
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Validation failed", 422, "VALIDATION_ERROR");
  const id = generateId();
  const signingSecret = generateWebhookSecret();
  await db.insert(schema.webhookEndpoints).values({ id, tenantId: auth.tenantId, url: parsed.data.url, events: parsed.data.events, signingSecret });
  return jsonOk({ id, signingSecret }, 201);
}
