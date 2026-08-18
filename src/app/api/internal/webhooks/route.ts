import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { generateId, generateWebhookSecret } from "@/lib/ids";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { WEBHOOK_EVENTS } from "@/db/schema";

const bodySchema = z.object({ url: z.string().url(), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1) });

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const rows = await db.select().from(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.tenantId, session.tenantId));
  return jsonOk(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const id = generateId();
  const signingSecret = generateWebhookSecret();
  await db.insert(schema.webhookEndpoints).values({ id, tenantId: session.tenantId, url: parsed.data.url, events: parsed.data.events, signingSecret });
  return jsonOk({ id, signingSecret }, 201);
}
