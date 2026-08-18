import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { dispatchWebhooks } from "@/modules/webhooks/dispatch";

const patchSchema = z.object({ status: z.enum(["OPEN", "DONE", "CANCELLED"]).optional() });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [before] = await db.select().from(schema.tasks).where(and(eq(schema.tasks.id, params.id), eq(schema.tasks.tenantId, session.tenantId))).limit(1);
  if (!before) return jsonError("Not found", 404);

  await db.update(schema.tasks).set(parsed.data).where(eq(schema.tasks.id, params.id));
  if (parsed.data.status === "DONE") await dispatchWebhooks(session.tenantId, "task.completed", { taskId: params.id });
  return jsonOk({ ok: true });
}
