import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

const patchSchema = z.object({
  name: z.string().optional(),
  role: z.string().optional(),
  company: z.string().optional(),
  instructions: z.string().optional(),
  tone: z.string().optional(),
  greeting: z.string().optional(),
  qualificationQuestions: z.array(z.string()).optional(),
  restrictedTopics: z.array(z.string()).optional(),
  escalationConditions: z.array(z.string()).optional(),
  salesRules: z.array(z.string()).optional(),
  widgetColor: z.string().optional(),
  status: z.enum(["ACTIVE", "PAUSED"]).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const [agent] = await db.select().from(schema.agents).where(and(eq(schema.agents.id, params.id), eq(schema.agents.tenantId, session.tenantId))).limit(1);
  if (!agent) return jsonError("Not found", 404);
  return jsonOk(agent);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "agents", "edit")) return jsonError("Forbidden", 403);

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [before] = await db.select().from(schema.agents).where(and(eq(schema.agents.id, params.id), eq(schema.agents.tenantId, session.tenantId))).limit(1);
  if (!before) return jsonError("Not found", 404);

  await db.update(schema.agents).set({ ...parsed.data, updatedAt: new Date() }).where(eq(schema.agents.id, params.id));
  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "agent.updated", entity: "agent", entityId: params.id, before, after: parsed.data });
  return jsonOk({ ok: true });
}
