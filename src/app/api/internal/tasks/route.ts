import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { eq, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { dispatchWebhooks } from "@/modules/webhooks/dispatch";

const bodySchema = z.object({
  title: z.string().min(1),
  opportunityId: z.string().optional(),
  leadId: z.string().optional(),
  assignedUserId: z.string().optional(),
  type: z.string().default("GENERAL"),
  dueAt: z.string().optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const rows = await db.select().from(schema.tasks).where(eq(schema.tasks.tenantId, session.tenantId)).orderBy(desc(schema.tasks.createdAt));
  return jsonOk(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const id = generateId();
  await db.insert(schema.tasks).values({
    id,
    tenantId: session.tenantId,
    ...parsed.data,
    dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
  });
  await dispatchWebhooks(session.tenantId, "task.created", { taskId: id });
  return jsonOk({ id }, 201);
}
