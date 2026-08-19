import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { listWidgets, createWidget } from "@/modules/widgets/service";

// Multi-agent-routing spec Part A — Widgets are the Channel-layer entity
// (routing config), kept deliberately separate from Agents (the
// intelligence). Permission-gated the same as "agents": this is agent-
// adjacent configuration, not a new access tier.

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const widgets = await listWidgets(session.tenantId);
  return jsonOk(widgets);
}

const createSchema = z.object({
  name: z.string().min(1),
  defaultAgentId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "agents", "create")) return jsonError("Forbidden", 403);

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [agent] = await db.select({ id: schema.agents.id }).from(schema.agents).where(and(eq(schema.agents.id, parsed.data.defaultAgentId), eq(schema.agents.tenantId, session.tenantId))).limit(1);
  if (!agent) return jsonError("Agent not found", 404);

  const widget = await createWidget({ tenantId: session.tenantId, name: parsed.data.name, defaultAgentId: parsed.data.defaultAgentId });
  return jsonOk(widget);
}
