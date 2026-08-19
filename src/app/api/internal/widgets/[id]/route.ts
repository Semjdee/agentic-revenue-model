import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { getWidget, listWidgetAgents, updateWidget } from "@/modules/widgets/service";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const widget = await getWidget(session.tenantId, params.id);
  if (!widget) return jsonError("Not found", 404);
  const agentLinks = await listWidgetAgents(widget.id);
  const agents = await db.select({ id: schema.agents.id, name: schema.agents.name, status: schema.agents.status }).from(schema.agents).where(eq(schema.agents.tenantId, session.tenantId));
  return jsonOk({ widget, agentLinks, agents });
}

const patchSchema = z.object({
  name: z.string().optional(),
  routingMode: z.enum(schema.WIDGET_ROUTING_MODES).optional(),
  defaultAgentId: z.string().nullable().optional(),
  fallbackAgentId: z.string().nullable().optional(),
  status: z.enum(schema.WIDGET_STATUSES).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "agents", "edit")) return jsonError("Forbidden", 403);

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const before = await getWidget(session.tenantId, params.id);
  if (!before) return jsonError("Not found", 404);

  const widget = await updateWidget(session.tenantId, params.id, parsed.data);
  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "widget.updated", entity: "widget", entityId: params.id, before, after: parsed.data });
  return jsonOk(widget);
}
