import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { generateId, generatePublicAgentId } from "@/lib/ids";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

const bodySchema = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  company: z.string().optional(),
  instructions: z.string().optional(),
  tone: z.string().optional(),
  greeting: z.string().optional(),
  qualificationQuestions: z.array(z.string()).default([]),
  restrictedTopics: z.array(z.string()).default([]),
  escalationConditions: z.array(z.string()).default([]),
  salesRules: z.array(z.string()).default([]),
  widgetColor: z.string().optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const rows = await db.select().from(schema.agents).where(eq(schema.agents.tenantId, session.tenantId));
  return jsonOk(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "agents", "create")) return jsonError("Forbidden", 403);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const id = generateId();
  await db.insert(schema.agents).values({ id, tenantId: session.tenantId, publicAgentId: generatePublicAgentId(), ...parsed.data });
  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "agent.created", entity: "agent", entityId: id });
  return jsonOk({ id }, 201);
}
